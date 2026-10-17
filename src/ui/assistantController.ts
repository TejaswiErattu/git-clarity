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
 */

import { ActionPlan, GitActionResult } from '../git/gitActions';
import { RepoSnapshot } from '../git/types';
import { IntentMatch, matchIntent } from '../assistant/intentMatcher';

export type AssistantPhase = 'idle' | 'preview' | 'done' | 'unrecognized';

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
}

export interface AssistantDeps {
	/** The workspace folder, or undefined when none is open. */
	cwd: string | undefined;
	readSnapshot(): RepoSnapshot | undefined;
	buildPlan(match: IntentMatch, cwd: string, snapshot: RepoSnapshot): ActionPlan | undefined;
	execute(match: IntentMatch, cwd: string): GitActionResult;
}

export const PLAN_CHANGED_NOTICE = 'Your project changed since this preview, so nothing ran. Check the updated plan and press Confirm again.';
export const STILL_BLOCKED_NOTICE = 'Nothing ran. This action cannot go ahead right now; see the reason below.';
const NO_REPO_RESULT: GitActionResult = {
	success: false,
	summary: 'Open a Git repository first.',
	details: 'The Assistant works on the folder you have open, and that folder is not a Git repository.'
};

export function initialAssistantState(): AssistantState {
	return { input: '', phase: 'idle', previewId: 0 };
}

/** True when the plan may run: not blocked and has at least one command. */
export function canConfirm(plan: ActionPlan | undefined): plan is ActionPlan {
	return plan !== undefined && !plan.blockedReason && plan.commands.length > 0;
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

function preview(state: AssistantState, match: IntentMatch, plan: ActionPlan, notice?: string): AssistantState {
	return { input: state.input, phase: 'preview', match, plan, previewId: state.previewId + 1, notice };
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
	return preview({ ...state, input }, match, plan);
}

export function confirm(state: AssistantState, previewId: number, deps: AssistantDeps): AssistantState {
	if (state.phase !== 'preview' || previewId !== state.previewId || !state.match || !state.plan) {
		return state;
	}
	const fresh = planFor(state.match, deps);
	if (!fresh || !deps.cwd) {
		return { input: state.input, phase: 'done', match: state.match, result: NO_REPO_RESULT, previewId: state.previewId };
	}
	if (!canConfirm(fresh)) {
		return preview(state, state.match, fresh, STILL_BLOCKED_NOTICE);
	}
	if (!samePlan(state.plan, fresh)) {
		return preview(state, state.match, fresh, PLAN_CHANGED_NOTICE);
	}
	const result = deps.execute(state.match, deps.cwd);
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
