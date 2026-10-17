/**
 * Secret Guard: the contract between the scanner backend and the dashboard UI.
 *
 * Agreed Sat Oct 17, 2026 at the DubHacks '26 kickoff.
 *   Backend owner: Thanishka (P1 scanning, P2 tests, P3 .gitignore action).
 *   UI owner:      Tejaswi  (T1 Safety tab, T2 Assistant block).
 * Do not change a signature in this file without telling the other person first.
 *
 * Implemented and working today:
 *   buildIgnoreKey, fixGuidanceFor, createAcknowledgedStore, createInMemoryAcknowledgedStore,
 *   addToGitignore, checkCommitGuard (correct as soon as the scan functions are real).
 *
 * Stubs that return "nothing found" until P1 lands:
 *   scanStagedDiff, scanPendingCommit  -> see TODO(P1) below.
 *
 * Design rules (from the Oct 1 plan):
 *   - Scan the diff, not whole files: only lines that are about to leave the machine count.
 *   - Acknowledge, never dismiss: an acknowledged finding is collapsed, not hidden, and the
 *     acknowledgement lives in workspaceState so it survives a reload but never leaks between projects.
 *   - Only HIGH severity blocks a commit. Medium and low are shown, never block.
 *   - Never silently allow, never permanently block.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SecretFinding, SecretScanResult } from './secretScanner';

// ---------------------------------------------------------------------------
// Scanning  (TODO(P1): Thanishka)
// ---------------------------------------------------------------------------

/**
 * Scan only the lines that are staged.
 *
 * Implementation contract:
 *   - Run `git diff --cached --unified=0` with an argv array (execFileSync, never a shell string).
 *   - Consider only lines that start with a single '+' (skip the '+++ b/file' header).
 *   - Parse each `@@ -a,b +c,d @@` hunk header so `line` is the real line number in the
 *     staged version of the file; count only '+' and ' ' lines when advancing.
 *   - Reuse the patterns, placeholder filter and masking from secretScanner.ts. Do not read
 *     whole files here: a secret in an unchanged part of a file is NOT staged.
 *   - `scannedFileCount` is the number of files that appeared in the diff.
 */
export function scanStagedDiff(cwd: string): SecretScanResult {
	// TODO(P1): implement. Stub: nothing is staged.
	void cwd;
	return { scannedFileCount: 0, findings: [], scannedAt: new Date().toISOString() };
}

/**
 * Scan everything the Assistant's "save my changes" would actually commit.
 *
 * The commit plan runs `git add -A` before `git commit`, so "about to be committed" means:
 *   - added lines in `git diff HEAD --unified=0` (tracked files, staged or not), PLUS
 *   - every line of every untracked file from `git ls-files --others --exclude-standard`,
 *     treated as added (skip the same binary extensions and directories secretScanner skips).
 * Share the hunk parser with scanStagedDiff. On a repo with no commits yet, treat every
 * tracked and untracked file as fully added.
 */
export function scanPendingCommit(cwd: string): SecretScanResult {
	// TODO(P1): implement. Stub: nothing pending.
	void cwd;
	return { scannedFileCount: 0, findings: [], scannedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Acknowledgements (implemented)
// ---------------------------------------------------------------------------

/**
 * Stable identity for a finding across refreshes: file + rule + a hash of the masked snippet.
 * Deliberately excludes the line number, which moves as the file is edited.
 */
export function buildIgnoreKey(finding: SecretFinding): string {
	const digest = createHash('sha1').update(finding.snippet).digest('hex').slice(0, 12);
	return `${finding.file}|${finding.ruleId}|${digest}`;
}

/** The subset of vscode.Memento this module needs, so it can run outside the VS Code host. */
export interface MementoLike {
	get<T>(key: string, defaultValue: T): T;
	update(key: string, value: unknown): PromiseLike<void>;
}

export interface AcknowledgedStore {
	isAcknowledged(key: string): boolean;
	acknowledge(key: string): Promise<void>;
	unacknowledge(key: string): Promise<void>;
	keys(): string[];
}

export const ACKNOWLEDGED_STATE_KEY = 'gitClarity.secretGuard.acknowledged';

/**
 * Persist acknowledgements in `context.workspaceState` (pass it in from extension.ts).
 * workspaceState is per-workspace, so one project's acknowledgements never leak into another.
 */
export function createAcknowledgedStore(memento: MementoLike): AcknowledgedStore {
	const keys = new Set<string>(memento.get<string[]>(ACKNOWLEDGED_STATE_KEY, []));
	const persist = () => memento.update(ACKNOWLEDGED_STATE_KEY, [...keys]);
	return {
		isAcknowledged: key => keys.has(key),
		async acknowledge(key) {
			keys.add(key);
			await persist();
		},
		async unacknowledge(key) {
			keys.delete(key);
			await persist();
		},
		keys: () => [...keys]
	};
}

/** For tests and for building the UI before the extension context is wired through. */
export function createInMemoryAcknowledgedStore(initial: string[] = []): AcknowledgedStore {
	const memory = new Map<string, unknown>([[ACKNOWLEDGED_STATE_KEY, initial]]);
	return createAcknowledgedStore({
		get: <T>(key: string, defaultValue: T): T => (memory.has(key) ? (memory.get(key) as T) : defaultValue),
		update: async (key: string, value: unknown) => {
			memory.set(key, value);
		}
	});
}

// ---------------------------------------------------------------------------
// Fix guidance (implemented; refine the copy freely, keep the shape)
// ---------------------------------------------------------------------------

export interface FixGuidance {
	/** Max ~6 words, no rule id. e.g. "AWS access key in config.js" */
	title: string;
	/** One sentence naming the file and line. Never includes the full secret. */
	what: string;
	/** One or two sentences a 19-year-old understands. */
	why: string;
	/** The concrete next step. */
	next: string;
	/** True when the right fix is to keep the whole file out of Git (e.g. .env, *.pem). */
	canAddToGitignore: boolean;
}

const IGNORABLE_FILE = /(^|\/)(\.env(\..+)?|.+\.(pem|key|p12|pfx))$/i;

const WHY_BY_RULE: Record<string, string> = {
	'aws-access-key': 'Anyone who gets this key can run up charges on the AWS account it belongs to.',
	'github-token': 'Anyone who gets this token can act as you on GitHub: push code, read private repos, delete things.',
	'google-api-key': 'Anyone who gets this key can call Google services on your account and run up its quota or bill.',
	'openai-key': 'Anyone who gets this key can make requests billed to your OpenAI account.',
	'slack-token': 'Anyone who gets this token can read and post in your Slack workspace as you.',
	'stripe-key': 'Anyone who gets this key can see and move real money in the Stripe account.',
	'private-key': 'A private key is the master password for a server or an SSH identity. Whoever has it is you.',
	'generic-secret': 'A password or token written straight into code goes wherever the code goes, including GitHub.'
};

export function fixGuidanceFor(finding: SecretFinding): FixGuidance {
	const base = path.posix.basename(finding.file.replace(/\\/g, '/'));
	const canAddToGitignore = IGNORABLE_FILE.test(finding.file);
	const pushedWarning =
		'If this reaches GitHub, bots that scan for leaked keys find it within minutes, and deleting it in a later commit does not remove it from the history.';
	const why = `${WHY_BY_RULE[finding.ruleId] ?? 'Secrets in code end up everywhere the code goes.'} ${pushedWarning}`;

	let next: string;
	if (canAddToGitignore) {
		next = `Keep ${base} out of Git: add it to .gitignore, then load the values from environment variables instead. If the value is real, treat it as leaked and create a new one.`;
	} else if (finding.ruleId === 'private-key') {
		next = 'Remove the key from this file, generate a new key pair, and keep private keys outside the repo.';
	} else {
		next = 'Move the value into an environment variable (for example a .env file that is in .gitignore), then treat this key as leaked: create a new one and revoke this one.';
	}

	return {
		title: `${finding.label} in ${base}`,
		what: `Line ${finding.line} of ${finding.file} looks like a ${finding.label.toLowerCase()}.`,
		why,
		next,
		canAddToGitignore
	};
}

// ---------------------------------------------------------------------------
// Commit guard (implemented; depends on scanPendingCommit)
// ---------------------------------------------------------------------------

export interface CommitGuardResult {
	blocked: boolean;
	/** Plain English, names the first file and line. Set only when blocked. */
	blockedReason?: string;
	/** Every finding in what would be committed, acknowledged or not, any severity. */
	findings: SecretFinding[];
	/** HIGH severity findings that have not been acknowledged. Non-empty means blocked. */
	unacknowledged: SecretFinding[];
}

/**
 * Decide whether the Assistant's commit may proceed. buildActionPlan calls this for the
 * commit intent and copies `blockedReason` onto the plan; executeAction calls it again right
 * before `git add -A` so the UI can never bypass it. Pass the same store from both call sites.
 */
export function checkCommitGuard(cwd: string, store: AcknowledgedStore): CommitGuardResult {
	const { findings } = scanPendingCommit(cwd);
	const unacknowledged = findings.filter(f => f.severity === 'high' && !store.isAcknowledged(buildIgnoreKey(f)));
	if (unacknowledged.length === 0) {
		return { blocked: false, findings, unacknowledged };
	}
	const first = unacknowledged[0];
	const more = unacknowledged.length - 1;
	const andMore = more > 0 ? ` (and ${more} more)` : '';
	return {
		blocked: true,
		blockedReason: `${first.file} line ${first.line} looks like a ${first.label.toLowerCase()}${andMore}. Remove it, or acknowledge it in the Safety tab if it is not a real secret.`,
		findings,
		unacknowledged
	};
}

// ---------------------------------------------------------------------------
// .gitignore action (implemented)
// ---------------------------------------------------------------------------

export interface GitignoreResult {
	/** False when the path was already listed. */
	added: boolean;
	/** The full .gitignore contents after the call. */
	gitignore: string;
}

/**
 * Append a repo-relative path to .gitignore, once, with a trailing newline. Creates the file if
 * needed. Does not touch the index: if the file is already tracked, the UI should say so and
 * offer "git rm --cached" as a follow-up (that is a P3 extension, not in scope here).
 */
export function addToGitignore(cwd: string, relativePath: string): GitignoreResult {
	const target = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
	const file = path.join(cwd, '.gitignore');
	const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
	const lines = existing.split(/\r?\n/).map(l => l.trim());
	const alreadyListed = lines.includes(target) || lines.includes(`/${target}`);
	if (alreadyListed) {
		return { added: false, gitignore: existing };
	}
	const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
	const updated = `${existing}${separator}${target}\n`;
	fs.writeFileSync(file, updated, 'utf8');
	return { added: true, gitignore: updated };
}
