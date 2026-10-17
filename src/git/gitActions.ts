/**
 * Guided Git Assistant — action plans and execution.
 *
 * This is the safety layer for the Assistant tab: it turns a matched intent
 * into a plan the UI can show *before* anything runs (commands, plain-English
 * explanation, affected files/branches, risk, undo info, warnings, and an
 * optional blockedReason that disables Confirm), and separately executes an
 * intent only when the user has explicitly confirmed it.
 *
 * Security note: commit messages and branch names come from free-text user
 * input. Every git invocation here uses execFileSync with an argv array
 * (never a shell string), so user input can never break out into shell
 * metacharacters/command injection. Branch names are additionally validated
 * against an allow-list pattern before being used anywhere.
 */

import { execFileSync } from 'child_process';
import { RepoSnapshot } from './types';
import { IntentId, IntentMatch } from '../assistant/intentMatcher';
import { AcknowledgedStore, checkCommitGuard, createInMemoryAcknowledgedStore } from '../safety/secretGuard';

export type RiskLevel = 'safe' | 'careful' | 'risky';

export interface ActionPlan {
	intentId: IntentId;
	title: string;
	/** The exact git command(s) that would run. Empty when the plan can't be built yet. */
	commands: string[];
	/** Plain-English explanation — no raw git jargon without a gloss. */
	explanation: string;
	/** Files or branches this action touches. */
	affected: string[];
	risk: RiskLevel;
	reversible: boolean;
	/** Plain-English line describing how to undo this (or why it can't be undone). */
	undoHint: string;
	warnings: string[];
	/** When set, Confirm must be disabled and this reason shown to the user. */
	blockedReason?: string;
}

export interface GitActionResult {
	success: boolean;
	summary: string;
	details?: string;
}

export interface ActionPlanOptions {
	/**
	 * Secret Guard acknowledgements. Pass the store built from context.workspaceState
	 * to BOTH buildActionPlan and executeAction, or the execute-time re-check will
	 * block a commit the user already acknowledged. Defaults to an empty store.
	 */
	acknowledged?: AcknowledgedStore;
}

/** Maps risk levels to the exact beginner-friendly badge text (never low/medium/high). */
export function riskLabel(risk: RiskLevel): string {
	switch (risk) {
		case 'safe': return 'Safe';
		case 'careful': return 'Careful';
		case 'risky': return 'Risky';
	}
}

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/;

function isValidBranchName(name: string): boolean {
	return BRANCH_NAME_PATTERN.test(name) && !name.includes('..');
}

// ─── Plan builders ──────────────────────────────────────────────────────

function planStatus(snapshot: RepoSnapshot): ActionPlan {
	return {
		intentId: 'status',
		title: 'Show what changed',
		commands: ['git status --short'],
		explanation: 'This lists every file you have edited but not yet saved (committed). It only looks — nothing changes.',
		affected: snapshot.changedFiles.map(f => f.path),
		risk: 'safe',
		reversible: true,
		undoHint: 'Nothing to undo — this only reads information.',
		warnings: []
	};
}

function planHistory(snapshot: RepoSnapshot): ActionPlan {
	return {
		intentId: 'history',
		title: 'Show recent history',
		commands: ['git log --oneline -10'],
		explanation: 'This shows your last 10 commits (saved checkpoints), newest first. It only looks — nothing changes.',
		affected: snapshot.commits.slice(0, 10).map(c => `${c.hash} ${c.message}`),
		risk: 'safe',
		reversible: true,
		undoHint: 'Nothing to undo — this only reads information.',
		warnings: []
	};
}

function planCommit(match: IntentMatch, cwd: string, snapshot: RepoSnapshot, options?: ActionPlanOptions): ActionPlan {
	const base = {
		intentId: 'commit' as const,
		title: 'Save your changes (commit)',
		explanation: 'A commit is a saved checkpoint of your work with a short note (the message) attached, so you can find it again later.',
		risk: 'careful' as const,
		reversible: true,
		undoHint: 'You can undo this afterwards by asking "Undo my last commit" — your file changes come back, uncommitted.',
		warnings: [] as string[]
	};

	if (!match.message) {
		return {
			...base,
			commands: [],
			affected: [],
			blockedReason: 'Add a short message describing what changed, e.g. "Save my changes: fixed the login bug".'
		};
	}

	if (snapshot.changedFileCount === 0) {
		return {
			...base,
			commands: [],
			affected: [],
			blockedReason: 'There is nothing to save — your files already match your last commit.'
		};
	}

	const commands = ['git add -A', `git commit -m "${match.message}"`];
	const affected = snapshot.changedFiles.map(f => f.path);

	// Secret Guard: the commit stages everything, so check everything that would be committed.
	const guard = checkCommitGuard(cwd, options?.acknowledged ?? createInMemoryAcknowledgedStore());
	if (guard.blocked) {
		return {
			...base,
			commands,
			affected,
			warnings: ['Secret Guard found something that looks like a real key in the files this would save.'],
			blockedReason: guard.blockedReason
		};
	}

	return { ...base, commands, affected };
}

function planUndoLastCommit(snapshot: RepoSnapshot): ActionPlan {
	const lastCommit = snapshot.commits[0];
	const base = {
		intentId: 'undoLastCommit' as const,
		title: 'Undo my last commit',
		commands: ['git reset --soft HEAD~1'],
		explanation: 'This removes your most recent commit but keeps all of its file changes — they go back to being uncommitted so you can redo or edit them.',
		risk: 'careful' as const,
		reversible: true,
		undoHint: 'If you change your mind, just save (commit) your changes again.',
	};

	if (!lastCommit) {
		return {
			...base,
			commands: [],
			affected: [],
			warnings: [],
			blockedReason: 'There are no commits yet, so there is nothing to undo.'
		};
	}

	return {
		...base,
		affected: [`Commit: "${lastCommit.message}"`],
		warnings: ['If you already uploaded (pushed) this commit, undoing it locally will not remove it from the remote — check with a teammate first.']
	};
}

const DISCARD_EXPLANATION = 'This permanently removes every uncommitted edit and restores your files to exactly how they were in your last commit.';
const DISCARD_UNDO_HINT = 'There is no undo for this. Commit or stash first if unsure.';

function planDiscardChanges(snapshot: RepoSnapshot): ActionPlan {
	if (snapshot.changedFileCount === 0) {
		return {
			intentId: 'discardChanges',
			title: 'Discard my uncommitted changes',
			commands: [],
			explanation: DISCARD_EXPLANATION,
			affected: [],
			risk: 'risky',
			reversible: false,
			undoHint: DISCARD_UNDO_HINT,
			warnings: [],
			blockedReason: 'There are no uncommitted changes to discard.'
		};
	}

	return {
		intentId: 'discardChanges',
		title: 'Discard my uncommitted changes',
		commands: ['git restore --staged .', 'git checkout -- .'],
		explanation: DISCARD_EXPLANATION,
		affected: snapshot.changedFiles.map(f => f.path),
		risk: 'risky',
		reversible: false,
		undoHint: DISCARD_UNDO_HINT,
		warnings: [`This permanently deletes uncommitted changes in ${snapshot.changedFileCount} file(s). There is no undo.`]
	};
}

function planNewBranch(match: IntentMatch, snapshot: RepoSnapshot): ActionPlan {
	const base = {
		intentId: 'newBranch' as const,
		title: 'Create a new branch',
		explanation: 'A branch is a separate copy of your project where you can make changes safely without affecting your other work. This creates a new one and moves you onto it right away.',
		risk: 'safe' as const,
		reversible: true,
		undoHint: 'You can switch back anytime, and delete this branch later if you do not need it.',
		warnings: [] as string[]
	};

	if (!match.branchName) {
		return { ...base, commands: [], affected: [], blockedReason: 'Add a name for the new branch, e.g. "Create a new branch called feature-login".' };
	}
	if (!isValidBranchName(match.branchName)) {
		return { ...base, commands: [], affected: [], blockedReason: 'Branch names can only use letters, numbers, dots, dashes, underscores, and slashes — try again without spaces or symbols.' };
	}
	if (snapshot.branches.some(b => b.name === match.branchName)) {
		return { ...base, commands: [], affected: [match.branchName], blockedReason: `A branch named "${match.branchName}" already exists — pick a different name, or ask to switch to it instead.` };
	}

	return { ...base, commands: [`git checkout -b ${match.branchName}`], affected: [match.branchName] };
}

function planSwitchBranch(match: IntentMatch, snapshot: RepoSnapshot): ActionPlan {
	const base = {
		intentId: 'switchBranch' as const,
		title: 'Switch branches',
		explanation: 'Switching branches changes which version of the project you are looking at and working on.',
		risk: 'careful' as const,
		reversible: true,
		undoHint: `You can switch back anytime by asking to switch to "${snapshot.currentBranch}".`,
		warnings: [] as string[]
	};

	if (!match.branchName) {
		return { ...base, commands: [], affected: [], blockedReason: 'Add the branch name you want to switch to, e.g. "Switch to branch called main".' };
	}
	if (!snapshot.branches.some(b => b.name === match.branchName)) {
		return { ...base, commands: [], affected: [match.branchName], blockedReason: `There is no branch named "${match.branchName}" in this project — check the spelling, or ask to create it.` };
	}
	if (match.branchName === snapshot.currentBranch) {
		return { ...base, commands: [], affected: [match.branchName], blockedReason: `You are already on "${match.branchName}".` };
	}
	if (snapshot.changedFileCount > 0) {
		return {
			...base,
			commands: [],
			affected: [snapshot.currentBranch, match.branchName],
			blockedReason: `You have ${snapshot.changedFileCount} unsaved file(s). Save (commit) or discard them first so switching branches doesn't risk losing work.`
		};
	}

	return { ...base, commands: [`git switch ${match.branchName}`], affected: [snapshot.currentBranch, match.branchName] };
}

function planPush(snapshot: RepoSnapshot): ActionPlan {
	const base = {
		intentId: 'push' as const,
		title: 'Upload my changes',
		commands: ['git push'],
		explanation: 'This uploads your saved commits to the shared remote (like GitHub) so teammates can see and download them.',
		affected: [snapshot.currentBranch],
		reversible: false,
		undoHint: 'Undoing an upload after teammates have already downloaded it is risky and usually needs a team conversation — this assistant will not do that for you.'
	};

	if (!snapshot.aheadBehind.hasUpstream) {
		return { ...base, risk: 'careful', commands: [], warnings: [], blockedReason: 'This branch is not connected to a remote (like GitHub) yet, so there is nothing set up to upload to.' };
	}
	if (snapshot.aheadBehind.ahead === 0) {
		return { ...base, risk: 'safe', warnings: [], blockedReason: 'There is nothing new to upload — your branch already matches the remote.' };
	}

	return {
		...base,
		risk: snapshot.aheadBehind.behind > 0 ? 'risky' : 'careful',
		warnings: snapshot.aheadBehind.behind > 0
			? [`Your branch is ${snapshot.aheadBehind.behind} commit(s) behind the remote — this upload may be rejected until you get the latest changes first.`]
			: []
	};
}

const DIVERGED_MESSAGE = 'Your branch and the remote both have new commits, so they cannot simply be lined up. Nothing was changed. Ask a teammate to help you combine them.';

function planPull(snapshot: RepoSnapshot): ActionPlan {
	const base = {
		intentId: 'pull' as const,
		title: 'Get the latest changes',
		commands: ['git pull --ff-only'],
		explanation: 'This downloads new commits from the shared remote (like GitHub) and moves your branch forward to include them. If your branch has its own commits the remote does not have, it stops and changes nothing.',
		affected: [snapshot.currentBranch],
		reversible: true,
		undoHint: 'This only adds the remote\'s new commits on top of where you were — none of your own commits are changed.'
	};

	if (!snapshot.aheadBehind.hasUpstream) {
		return { ...base, risk: 'careful', commands: [], warnings: [], blockedReason: 'This branch is not connected to a remote yet, so there is nothing to download from.' };
	}
	if (snapshot.aheadBehind.behind === 0) {
		return { ...base, risk: 'safe', warnings: [], blockedReason: 'You are already up to date — there is nothing new to get.' };
	}
	if (snapshot.aheadBehind.ahead > 0) {
		return { ...base, risk: 'careful', commands: [], warnings: [], blockedReason: DIVERGED_MESSAGE };
	}

	return {
		...base,
		risk: snapshot.changedFileCount > 0 ? 'risky' : 'careful',
		warnings: snapshot.changedFileCount > 0
			? [`You have ${snapshot.changedFileCount} unsaved file(s). Downloading changes could conflict with them — consider saving or discarding your changes first.`]
			: []
	};
}

/**
 * Builds the plan for a matched intent, including any blockedReason. Never
 * runs anything. Returns undefined when there is no intent to plan for.
 */
export function buildActionPlan(match: IntentMatch, cwd: string, snapshot: RepoSnapshot, options?: ActionPlanOptions): ActionPlan | undefined {
	// Planning must stay read-only: Secret Guard runs `git diff`, nothing that writes.
	switch (match.intentId) {
		case 'status': return planStatus(snapshot);
		case 'history': return planHistory(snapshot);
		case 'commit': return planCommit(match, cwd, snapshot, options);
		case 'undoLastCommit': return planUndoLastCommit(snapshot);
		case 'discardChanges': return planDiscardChanges(snapshot);
		case 'newBranch': return planNewBranch(match, snapshot);
		case 'switchBranch': return planSwitchBranch(match, snapshot);
		case 'push': return planPush(snapshot);
		case 'pull': return planPull(snapshot);
		default: return undefined;
	}
}

// ─── Execution ──────────────────────────────────────────────────────────

/**
 * Arguments the Assistant must never pass to git: each one can delete,
 * overwrite, or rewrite work. Checked before every execution as defence in
 * depth, even though every intent's argv is hard-coded below.
 */
export const DENIED_ARGS: readonly string[] = ['--force', '-f', '--hard', 'reset', 'clean', 'rebase', 'filter-branch', '--delete', '-D', '--mirror'];

/** The only allowed use of a denied argument: undoLastCommit, which keeps the work. */
const ALLOWED_EXCEPTIONS: readonly (readonly string[])[] = [['reset', '--soft', 'HEAD~1']];

export class DeniedGitArgsError extends Error {
	constructor(public readonly denied: string[]) {
		super(`Blocked git arguments: ${denied.join(', ')}`);
		this.name = 'DeniedGitArgsError';
	}
}

/** Returns the denied arguments in args, or [] if it is safe to run. A commit message (the value after -m) is text, not an argument, so it is skipped. */
export function findDeniedArgs(args: readonly string[]): string[] {
	if (ALLOWED_EXCEPTIONS.some(allowed => allowed.length === args.length && allowed.every((a, i) => a === args[i]))) {
		return [];
	}
	return args.filter((arg, i) => args[i - 1] !== '-m' && (DENIED_ARGS.includes(arg) || arg.startsWith('--force')));
}

/** Runs git with an argv array (never a shell), after the deny-list check. */
export function runGitArgs(cwd: string, args: string[]): string {
	const denied = findDeniedArgs(args);
	if (denied.length > 0) {
		throw new DeniedGitArgsError(denied);
	}
	return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function localBranchExists(cwd: string, name: string): boolean {
	try {
		execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${name}`], { cwd, stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

function friendlyError(action: string, err: unknown): GitActionResult {
	if (err instanceof DeniedGitArgsError) {
		return {
			success: false,
			summary: `${action} was blocked.`,
			details: 'Git Clarity stopped this command because it could delete or overwrite your work. Nothing was changed.'
		};
	}
	const stderr = (err as { stderr?: Buffer | string })?.stderr?.toString().trim();
	return {
		success: false,
		summary: `${action} did not finish.`,
		details: stderr
			? `Git said: ${stderr.split('\n')[0]}`
			: 'An unexpected error happened and nothing was changed.'
	};
}

/**
 * Runs the intent's git command(s) for real. Only call this after the user
 * has pressed Confirm on an unblocked plan.
 */
export function executeAction(match: IntentMatch, cwd: string, options?: ActionPlanOptions): GitActionResult {
	switch (match.intentId) {
		case 'status': {
			try {
				const output = runGitArgs(cwd, ['status', '--short']);
				return { success: true, summary: output ? 'Here is what changed.' : 'Nothing has changed — your files match your last commit.', details: output || undefined };
			} catch (err) {
				return friendlyError('Checking what changed', err);
			}
		}
		case 'history': {
			try {
				const output = runGitArgs(cwd, ['log', '--oneline', '-10']);
				return { success: true, summary: 'Here is your recent history.', details: output || undefined };
			} catch (err) {
				return friendlyError('Loading your history', err);
			}
		}
		case 'commit': {
			if (!match.message) {
				return { success: false, summary: 'A commit message is required.', details: 'Type a short message describing what changed and try again.' };
			}
			// Re-check at execute time so the UI can never bypass Secret Guard.
			const guard = checkCommitGuard(cwd, options?.acknowledged ?? createInMemoryAcknowledgedStore());
			if (guard.blocked) {
				return { success: false, summary: 'Saving was stopped by Secret Guard.', details: guard.blockedReason };
			}
			try {
				runGitArgs(cwd, ['add', '-A']);
				runGitArgs(cwd, ['commit', '-m', match.message]);
				return { success: true, summary: 'Your changes are saved.', details: `Commit message: "${match.message}"` };
			} catch (err) {
				return friendlyError('Saving your changes', err);
			}
		}
		case 'undoLastCommit': {
			try {
				runGitArgs(cwd, ['reset', '--soft', 'HEAD~1']);
				return { success: true, summary: 'Your last commit was undone.', details: 'Its file changes are back, uncommitted.' };
			} catch (err) {
				return friendlyError('Undoing your last commit', err);
			}
		}
		case 'discardChanges': {
			try {
				runGitArgs(cwd, ['restore', '--staged', '.']);
				runGitArgs(cwd, ['checkout', '--', '.']);
				return { success: true, summary: 'Your uncommitted changes were discarded.' };
			} catch (err) {
				return friendlyError('Discarding your changes', err);
			}
		}
		case 'newBranch': {
			if (!match.branchName || !isValidBranchName(match.branchName)) {
				return { success: false, summary: 'A valid branch name is required.', details: 'Branch names can only use letters, numbers, dots, dashes, underscores, and slashes.' };
			}
			try {
				runGitArgs(cwd, ['checkout', '-b', match.branchName]);
				return { success: true, summary: `Created and switched to "${match.branchName}".` };
			} catch (err) {
				return friendlyError('Creating your new branch', err);
			}
		}
		case 'switchBranch': {
			if (!match.branchName || !isValidBranchName(match.branchName)) {
				return { success: false, summary: 'A valid branch name is required.', details: 'Check the branch name and try again.' };
			}
			if (!localBranchExists(cwd, match.branchName)) {
				return { success: false, summary: `There is no branch named "${match.branchName}".`, details: 'Nothing was changed. Check the spelling, or ask to create it.' };
			}
			try {
				runGitArgs(cwd, ['switch', match.branchName]);
				return { success: true, summary: `Switched to "${match.branchName}".` };
			} catch (err) {
				return friendlyError('Switching branches', err);
			}
		}
		case 'push': {
			try {
				runGitArgs(cwd, ['push']);
				return { success: true, summary: 'Your commits were uploaded to the remote.' };
			} catch (err) {
				return friendlyError('Uploading your changes', err);
			}
		}
		case 'pull': {
			try {
				runGitArgs(cwd, ['pull', '--ff-only']);
				return { success: true, summary: 'You have the latest changes.' };
			} catch (err) {
				const stderr = (err as { stderr?: Buffer | string })?.stderr?.toString() ?? '';
				if (/fast-forward|diverg/i.test(stderr)) {
					return { success: false, summary: 'Getting the latest changes did not finish.', details: DIVERGED_MESSAGE };
				}
				return friendlyError('Getting the latest changes', err);
			}
		}
		default:
			return { success: false, summary: 'This request is not supported yet.' };
	}
}
