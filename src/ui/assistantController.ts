/**
 * Assistant tab state and transitions.
 *
 * Pure functions: state in, state out. Git access comes in through AssistantDeps so the
 * safety rules below are unit tested without a VS Code host or a real repository.
 *
 * Safety rules:
 *   - ask() only matches and plans. It never executes anything.
 *   - confirm() is the only path to execute(). It runs only for the preview the user is looking
 *     at (previewId must match), rebuilds the plan from a fresh snapshot first, and refuses to
 *     run when the fresh plan is blocked (including by Secret Guard), has no commands, or differs
 *     from what was previewed. In those cases it shows the fresh plan for a second look instead.
 *   - Commands come only from buildActionPlan / executeAction: deterministic, never chosen by a model.
 *   - Secret Guard (T3): a commit preview lists the findings that block it. Nothing here ever
 *     acknowledges a finding; that only happens when the user clicks Acknowledge. A secret that
 *     appears after the preview, or an executeAction refusal, ends in a "Not saved" result.
 */

import { ActionPlan, GitActionResult } from '../git/gitActions';
import { RepoSnapshot } from '../git/types';
import { IntentMatch, matchIntent } from '../assistant/intentMatcher';
import { CommitGuardResult } from '../safety/secretGuard';
import { SafetyFindingView, toFindingView } from './safetyModel';

export type AssistantPhase = 'idle' | 'preview' | 'done' | 'unrecognized';

/** Secret Guard's view of a commit preview. */
export interface AssistantGuard {
	blocked: boolean;
	/** High-severity findings that are not acknowledged: what blocks the commit. */
	findings: SafetyFindingView[];
	/** Other findings (medium, low or acknowledged) that are shown in the Safety tab but do not block. */
	otherCount: number;
}

export interface AssistantState {
	/** What is in the text box. */
	input: string;
	phase: AssistantPhase;
	match?: IntentMatch;
	plan?: ActionPlan;
	result?: GitActionResult;
	/** Bumps on every new preview. Confirm must echo it, so a stale click can never run a newer plan. */
	previewId: number;
	/** One-line message shown above a preview, e.g. when the plan changed before Confirm. */
	notice?: string;
	/** Secret Guard findings for a commit preview. Absent for other intents. */
	guard?: AssistantGuard;
	/** True on a "Not saved" commit result: the user can go back to a freshly rebuilt plan. */
	canReturnToPlan?: boolean;
}

export interface AssistantDeps {
	/** The workspace folder, or undefined when none is open. */
	cwd: string | undefined;
	readSnapshot(): RepoSnapshot | undefined;
	buildPlan(match: IntentMatch, cwd: string, snapshot: RepoSnapshot): ActionPlan | undefined;
	execute(match: IntentMatch, cwd: string): GitActionResult;
	/** checkCommitGuard bound to the shared acknowledged store. Optional so non-commit callers can omit it. */
	checkGuard?(cwd: string): CommitGuardResult;
}

export const PLAN_CHANGED_NOTICE = 'Your project changed since this preview, so nothing ran. Check the updated plan and press Confirm again.';
export const STILL_BLOCKED_NOTICE = 'Nothing ran. This action cannot go ahead right now; see the reason below.';
export const UNBLOCKED_NOTICE = 'Nothing is blocking this commit now. Review the plan and press Confirm.';
export const NEW_SECRET_SUMMARY = 'Not saved. A new possible secret appeared after your preview.';
const NO_REPO_RESULT: GitActionResult = {
	success: false,
	summary: 'Open a Git repository first.',
	details: 'The Assistant works on the folder you have open, and that folder is not a Git repository.'
};

export function initialAssistantState(): AssistantState {
	return { input: '', phase: 'idle', previewId: 0 };
}

/** True when the plan may run: not blocked (by the plan or by Secret Guard) and has at least one command. */
export function canConfirm(plan: ActionPlan | undefined, guard?: AssistantGuard): plan is ActionPlan {
	return plan !== undefined && !plan.blockedReason && plan.commands.length > 0 && !guard?.blocked;
}

/** Secret Guard findings for a commit plan that would actually run commands. */
function guardFor(plan: ActionPlan, deps: AssistantDeps): { view: AssistantGuard; result: CommitGuardResult } | undefined {
	if (plan.intentId !== 'commit' || plan.commands.length === 0 || !deps.checkGuard || !deps.cwd) {
		return undefined;
	}
	const result = deps.checkGuard(deps.cwd);
	const findings = result.unacknowledged.map(f => toFindingView(f, () => false));
	return { result, view: { blocked: result.blocked, findings, otherCount: result.findings.length - result.unacknowledged.length } };
}

/** What the user saw and agreed to: the commands, the files they touch, and the risk. */
function samePlan(a: ActionPlan, b: ActionPlan): boolean {
	const sameList = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
	return a.intentId === b.intentId && a.risk === b.risk && sameList(a.commands, b.commands) && sameList(a.affected, b.affected);
}

function planFor(match: IntentMatch, deps: AssistantDeps): ActionPlan | undefined {
	const snapshot = deps.readSnapshot();
	if (!deps.cwd || !snapshot?.isRepo) {
		return undefined;
	}
	return deps.buildPlan(match, deps.cwd, snapshot);
}

function preview(state: AssistantState, match: IntentMatch, plan: ActionPlan, deps: AssistantDeps, notice?: string): AssistantState {
	const guard = guardFor(plan, deps)?.view;
	return { input: state.input, phase: 'preview', match, plan, previewId: state.previewId + 1, notice, guard };
}

function notSaved(state: AssistantState, match: IntentMatch, result: GitActionResult): AssistantState {
	return { input: state.input, phase: 'done', match, result, previewId: state.previewId, canReturnToPlan: true };
}

export function ask(state: AssistantState, text: string, deps: AssistantDeps): AssistantState {
	const input = text.trim();
	if (!input) {
		return { ...state, input: '' };
	}
	const match = matchIntent(input);
	if (match.intentId === null) {
		return { input, phase: 'unrecognized', match, previewId: state.previewId };
	}
	const plan = planFor(match, deps);
	if (!plan) {
		return { input, phase: 'done', match, result: NO_REPO_RESULT, previewId: state.previewId };
	}
	return preview({ ...state, input }, match, plan, deps);
}

/**
 * Rebuild the current preview from a fresh snapshot, e.g. after a finding was acknowledged or
 * un-acknowledged. Never executes. Bumps previewId so a Confirm aimed at the old preview is ignored.
 */
export function refreshPreview(state: AssistantState, deps: AssistantDeps): AssistantState {
	if (state.phase !== 'preview' || !state.match) {
		return state;
	}
	const plan = planFor(state.match, deps);
	if (!plan) {
		return { input: state.input, phase: 'done', match: state.match, result: NO_REPO_RESULT, previewId: state.previewId };
	}
	const next = preview(state, state.match, plan, deps);
	const wasBlocked = !canConfirm(state.plan, state.guard);
	if (wasBlocked && state.guard?.blocked && canConfirm(next.plan, next.guard)) {
		next.notice = UNBLOCKED_NOTICE;
	}
	return next;
}

/** From a "Not saved" result back to a freshly rebuilt plan. Never reuses the old plan. */
export function backToPlan(state: AssistantState, deps: AssistantDeps): AssistantState {
	if (state.phase !== 'done' || !state.canReturnToPlan || !state.match) {
		return state;
	}
	const plan = planFor(state.match, deps);
	if (!plan) {
		return { input: state.input, phase: 'done', match: state.match, result: NO_REPO_RESULT, previewId: state.previewId };
	}
	return preview(state, state.match, plan, deps);
}

export function confirm(state: AssistantState, previewId: number, deps: AssistantDeps): AssistantState {
	if (state.phase !== 'preview' || previewId !== state.previewId || !state.match || !state.plan) {
		return state;
	}
	const fresh = planFor(state.match, deps);
	if (!fresh || !deps.cwd) {
		return { input: state.input, phase: 'done', match: state.match, result: NO_REPO_RESULT, previewId: state.previewId };
	}
	const guard = guardFor(fresh, deps);
	if (guard?.result.blocked) {
		return notSaved(state, state.match, {
			success: false,
			summary: NEW_SECRET_SUMMARY,
			details: guard.result.blockedReason
		});
	}
	if (!canConfirm(fresh)) {
		return preview(state, state.match, fresh, deps, STILL_BLOCKED_NOTICE);
	}
	if (!samePlan(state.plan, fresh)) {
		return preview(state, state.match, fresh, deps, PLAN_CHANGED_NOTICE);
	}
	const result = deps.execute(state.match, deps.cwd);
	if (!result.success && state.match.intentId === 'commit') {
		return notSaved(state, state.match, result);
	}
	return {
		input: result.success ? '' : state.input,
		phase: 'done',
		match: state.match,
		plan: fresh,
		result,
		previewId: state.previewId
	};
}

export function cancel(state: AssistantState): AssistantState {
	return { input: state.input, phase: 'idle', previewId: state.previewId };
}
