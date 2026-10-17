import * as assert from 'assert';
import { IntentMatch } from '../assistant/intentMatcher';
import { ActionPlan, GitActionResult } from '../git/gitActions';
import { RepoSnapshot } from '../git/types';
import {
	ask,
	AssistantDeps,
	AssistantState,
	cancel,
	confirm,
	initialAssistantState,
	PLAN_CHANGED_NOTICE,
	STILL_BLOCKED_NOTICE
} from '../ui/assistantController';

const SNAPSHOT = { isRepo: true } as RepoSnapshot;

function plan(overrides: Partial<ActionPlan> = {}): ActionPlan {
	return {
		intentId: 'status',
		title: 'Show what changed',
		commands: ['git status --short'],
		explanation: 'Lists changed files.',
		affected: ['a.txt'],
		risk: 'safe',
		reversible: true,
		undoHint: 'Nothing to undo.',
		warnings: [],
		...overrides
	};
}

/** Fake Git access: returns queued plans in order and records every execute call. */
function fakeDeps(plans: ActionPlan[], result: GitActionResult = { success: true, summary: 'ok' }) {
	const executed: IntentMatch[] = [];
	let built = 0;
	const deps: AssistantDeps = {
		cwd: '/repo',
		readSnapshot: () => SNAPSHOT,
		buildPlan: () => plans[Math.min(built++, plans.length - 1)],
		execute: match => {
			executed.push(match);
			return result;
		}
	};
	return { deps, executed, builds: () => built };
}

function previewOf(p: ActionPlan, text = 'what changed'): { state: AssistantState; deps: AssistantDeps; executed: IntentMatch[] } {
	const fake = fakeDeps([p, p]);
	return { state: ask(initialAssistantState(), text, fake.deps), deps: fake.deps, executed: fake.executed };
}

suite('assistantController: nothing runs without Confirm', () => {
	test('an unrecognized request shows the supported list and builds no plan', () => {
		const fake = fakeDeps([plan()]);
		const state = ask(initialAssistantState(), 'make me a sandwich', fake.deps);
		assert.strictEqual(state.phase, 'unrecognized');
		assert.strictEqual(state.plan, undefined);
		assert.strictEqual(fake.builds(), 0);
		assert.strictEqual(fake.executed.length, 0);
	});

	test('empty input does nothing', () => {
		const fake = fakeDeps([plan()]);
		const state = ask(initialAssistantState(), '   ', fake.deps);
		assert.strictEqual(state.phase, 'idle');
		assert.strictEqual(fake.builds(), 0);
	});

	test('asking a known request previews it and does not execute', () => {
		const { state, executed } = previewOf(plan());
		assert.strictEqual(state.phase, 'preview');
		assert.strictEqual(state.match?.intentId, 'status');
		assert.strictEqual(state.previewId, 1);
		assert.strictEqual(executed.length, 0);
	});

	test('confirm with a stale preview id, or outside a preview, does nothing', () => {
		const { state, deps, executed } = previewOf(plan());
		assert.strictEqual(confirm(state, state.previewId - 1, deps), state);
		const idle = cancel(state);
		assert.strictEqual(confirm(idle, idle.previewId, deps), idle);
		assert.strictEqual(executed.length, 0);
	});

	test('confirm rebuilds the plan and refuses to run when it is now blocked', () => {
		const blocked = plan({ blockedReason: 'Secret Guard found a key.' });
		const fake = fakeDeps([plan(), blocked]);
		const state = ask(initialAssistantState(), 'what changed', fake.deps);
		const next = confirm(state, state.previewId, fake.deps);
		assert.strictEqual(fake.builds(), 2, 'the plan was rebuilt from a fresh snapshot');
		assert.strictEqual(fake.executed.length, 0);
		assert.strictEqual(next.phase, 'preview');
		assert.strictEqual(next.plan?.blockedReason, 'Secret Guard found a key.');
		assert.strictEqual(next.notice, STILL_BLOCKED_NOTICE);
		assert.strictEqual(next.previewId, state.previewId + 1);
	});

	test('confirm refuses to run when commands or affected files changed since the preview', () => {
		for (const changed of [plan({ commands: ['git status'] }), plan({ affected: ['a.txt', 'secret.env'] }), plan({ risk: 'careful' })]) {
			const fake = fakeDeps([plan(), changed]);
			const state = ask(initialAssistantState(), 'what changed', fake.deps);
			const next = confirm(state, state.previewId, fake.deps);
			assert.strictEqual(fake.executed.length, 0);
			assert.strictEqual(next.phase, 'preview');
			assert.strictEqual(next.notice, PLAN_CHANGED_NOTICE);
		}
	});

	test('confirm on an unchanged, unblocked plan executes exactly once and clears the input', () => {
		const { state, deps, executed } = previewOf(plan());
		const next = confirm(state, state.previewId, deps);
		assert.strictEqual(executed.length, 1);
		assert.strictEqual(executed[0].intentId, 'status');
		assert.strictEqual(next.phase, 'done');
		assert.strictEqual(next.result?.success, true);
		assert.strictEqual(next.input, '');
		assert.strictEqual(confirm(next, next.previewId, deps), next, 'a second click does not run it again');
		assert.strictEqual(executed.length, 1);
	});

	test('a failed execution keeps the input so the user can adjust it', () => {
		const fake = fakeDeps([plan(), plan()], { success: false, summary: 'did not finish' });
		const state = ask(initialAssistantState(), 'what changed', fake.deps);
		const next = confirm(state, state.previewId, fake.deps);
		assert.strictEqual(next.result?.success, false);
		assert.strictEqual(next.input, 'what changed');
	});

	test('cancel returns to idle, keeps the input and runs nothing', () => {
		const { state, executed } = previewOf(plan(), 'what changed');
		const next = cancel(state);
		assert.strictEqual(next.phase, 'idle');
		assert.strictEqual(next.input, 'what changed');
		assert.strictEqual(next.plan, undefined);
		assert.strictEqual(executed.length, 0);
	});

	test('without a repository, asking explains that instead of planning', () => {
		const fake = fakeDeps([plan()]);
		fake.deps.readSnapshot = () => ({ isRepo: false } as RepoSnapshot);
		const state = ask(initialAssistantState(), 'what changed', fake.deps);
		assert.strictEqual(state.phase, 'done');
		assert.strictEqual(state.result?.success, false);
		assert.strictEqual(fake.builds(), 0);
		assert.strictEqual(fake.executed.length, 0);
	});
});
