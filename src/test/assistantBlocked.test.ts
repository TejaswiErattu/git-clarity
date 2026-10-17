import * as assert from 'assert';
import { IntentMatch } from '../assistant/intentMatcher';
import { ActionPlan, buildActionPlan, executeAction, GitActionResult } from '../git/gitActions';
import { getRepoSnapshot } from '../git/gitCommands';
import { RepoSnapshot } from '../git/types';
import { AcknowledgedStore, buildIgnoreKey, checkCommitGuard, CommitGuardResult, createInMemoryAcknowledgedStore } from '../safety/secretGuard';
import { SecretFinding } from '../safety/secretScanner';
import {
	ask,
	AssistantDeps,
	AssistantState,
	backToPlan,
	canConfirm,
	confirm,
	initialAssistantState,
	NEW_SECRET_SUMMARY,
	PLAN_CHANGED_NOTICE,
	refreshPreview,
	UNBLOCKED_NOTICE
} from '../ui/assistantController';
import { ACKNOWLEDGE_WARNING, BLOCKED_HEADING, renderAssistant } from '../ui/render/assistant';
import { escapeHtml } from '../ui/render/html';
import { cleanupTempDirs, git, isolateGitEnv, makeTempRepo, writeFile } from './helpers/tempRepo';

// AKIA + 16 upper-case alphanumerics, with nothing the placeholder filter would catch.
const FAKE_AWS_KEY = 'AKIA' + 'ZZ9Q4K2M7T1B8R3W';
const SNAPSHOT = { isRepo: true } as RepoSnapshot;
const COMMIT_TEXT = 'save my changes: add config';
const BLOCKED_REASON = 'src/config.js line 2 looks like a aws access key. Remove it, or acknowledge it in the Safety tab if it is not a real secret.';

function finding(overrides: Partial<SecretFinding> = {}): SecretFinding {
	return {
		file: 'src/config.js',
		line: 2,
		column: 13,
		ruleId: 'aws-access-key',
		label: 'AWS access key',
		severity: 'high',
		snippet: 'const key = "AKIA…8R3W";',
		...overrides
	};
}

function commitPlan(overrides: Partial<ActionPlan> = {}): ActionPlan {
	return {
		intentId: 'commit',
		title: 'Save your changes (commit)',
		commands: ['git add -A', 'git commit -m "add config"'],
		explanation: 'A commit is a saved checkpoint.',
		affected: ['src/config.js'],
		risk: 'careful',
		reversible: true,
		undoHint: 'Ask "Undo my last commit".',
		warnings: [],
		...overrides
	};
}

const blockedPlan = (reason = BLOCKED_REASON) => commitPlan({
	blockedReason: reason,
	warnings: ['Secret Guard found something that looks like a real key in the files this would save.']
});

function guardResult(unacknowledged: SecretFinding[], others: SecretFinding[] = []): CommitGuardResult {
	return unacknowledged.length > 0
		? { blocked: true, blockedReason: BLOCKED_REASON, findings: [...unacknowledged, ...others], unacknowledged }
		: { blocked: false, findings: others, unacknowledged: [] };
}

/** Fake Git access driven by queues: each build or guard check takes the next entry (the last one repeats). */
function fakeDeps(plans: ActionPlan[], guards: CommitGuardResult[], result: GitActionResult = { success: true, summary: 'Your changes are saved.' }) {
	const executed: IntentMatch[] = [];
	let p = 0;
	let g = 0;
	const deps: AssistantDeps = {
		cwd: '/repo',
		readSnapshot: () => SNAPSHOT,
		buildPlan: () => plans[Math.min(p++, plans.length - 1)],
		execute: match => {
			executed.push(match);
			return result;
		},
		checkGuard: () => guards[Math.min(g++, guards.length - 1)]
	};
	return { deps, executed };
}

/** A store that records acknowledge calls, to prove nothing is acknowledged automatically. */
function spyStore(): { store: AcknowledgedStore; calls: string[] } {
	const inner = createInMemoryAcknowledgedStore();
	const calls: string[] = [];
	return {
		calls,
		store: {
			...inner,
			acknowledge: async key => {
				calls.push(key);
				await inner.acknowledge(key);
			}
		}
	};
}

suite('Assistant: blocked-commit flow (T3)', () => {
	suiteSetup(isolateGitEnv);
	suiteTeardown(cleanupTempDirs);

	// ---- controller ----------------------------------------------------------------

	test('a commit blocked by Secret Guard previews its findings and cannot be confirmed', () => {
		const { deps, executed } = fakeDeps([blockedPlan()], [guardResult([finding()], [finding({ severity: 'medium', file: 'b.js' })])]);
		const state = ask(initialAssistantState(), COMMIT_TEXT, deps);
		assert.strictEqual(state.phase, 'preview');
		assert.strictEqual(state.guard?.blocked, true);
		assert.deepStrictEqual(state.guard?.findings.map(f => `${f.file}:${f.line}`), ['src/config.js:2']);
		assert.strictEqual(state.guard?.findings[0].key, buildIgnoreKey(finding()));
		assert.strictEqual(state.guard?.otherCount, 1);
		assert.strictEqual(canConfirm(state.plan, state.guard), false);
		assert.strictEqual(confirm(state, state.previewId, deps).phase, 'done', 'a forced confirm still never runs');
		assert.strictEqual(executed.length, 0);
	});

	test('Confirm stays disabled when the guard blocks even if the plan itself has no reason', () => {
		assert.strictEqual(canConfirm(commitPlan(), { blocked: true, findings: [], otherCount: 0 }), false);
		assert.strictEqual(canConfirm(commitPlan(), { blocked: false, findings: [], otherCount: 0 }), true);
	});

	test('after acknowledgement, refreshPreview rebuilds an unblocked plan without running anything', () => {
		const { deps, executed } = fakeDeps([blockedPlan(), commitPlan()], [guardResult([finding()]), guardResult([], [finding()])]);
		const blocked = ask(initialAssistantState(), COMMIT_TEXT, deps);
		const next = refreshPreview(blocked, deps);
		assert.strictEqual(next.phase, 'preview');
		assert.strictEqual(next.guard?.blocked, false);
		assert.strictEqual(next.notice, UNBLOCKED_NOTICE);
		assert.strictEqual(next.previewId, blocked.previewId + 1, 'a Confirm aimed at the old preview is ignored');
		assert.strictEqual(canConfirm(next.plan, next.guard), true);
		assert.strictEqual(executed.length, 0);
		assert.strictEqual(confirm(next, blocked.previewId, deps), next);
	});

	test('undoing an acknowledgement blocks the preview again', () => {
		const { deps } = fakeDeps([commitPlan(), blockedPlan()], [guardResult([]), guardResult([finding()])]);
		const clean = ask(initialAssistantState(), COMMIT_TEXT, deps);
		const next = refreshPreview(clean, deps);
		assert.strictEqual(next.guard?.blocked, true);
		assert.strictEqual(canConfirm(next.plan, next.guard), false);
		assert.strictEqual(next.notice, undefined);
	});

	test('a secret that appears after the preview stops the commit with "Not saved" and a way back', () => {
		const { deps, executed } = fakeDeps(
			[commitPlan(), blockedPlan(), blockedPlan()],
			[guardResult([]), guardResult([finding()]), guardResult([finding()])]
		);
		const clean = ask(initialAssistantState(), COMMIT_TEXT, deps);
		assert.strictEqual(canConfirm(clean.plan, clean.guard), true);
		const refused = confirm(clean, clean.previewId, deps);
		assert.strictEqual(executed.length, 0, 'nothing ran');
		assert.strictEqual(refused.phase, 'done');
		assert.strictEqual(refused.result?.success, false);
		assert.strictEqual(refused.result?.summary, NEW_SECRET_SUMMARY);
		assert.strictEqual(refused.result?.details, BLOCKED_REASON);
		assert.strictEqual(refused.canReturnToPlan, true);
		assert.strictEqual(refused.input, COMMIT_TEXT, 'the request is kept');

		const back = backToPlan(refused, deps);
		assert.strictEqual(back.phase, 'preview');
		assert.strictEqual(back.guard?.blocked, true);
		assert.strictEqual(back.previewId, clean.previewId + 1);
		assert.strictEqual(executed.length, 0);
	});

	test('when executeAction refuses the commit, the result is "Not saved" with the reason', () => {
		const refusal = { success: false, summary: 'Saving was stopped by Secret Guard.', details: BLOCKED_REASON };
		const { deps, executed } = fakeDeps([commitPlan()], [guardResult([])], refusal);
		const clean = ask(initialAssistantState(), COMMIT_TEXT, deps);
		const next = confirm(clean, clean.previewId, deps);
		assert.strictEqual(executed.length, 1);
		assert.strictEqual(next.phase, 'done');
		assert.strictEqual(next.result?.summary, 'Saving was stopped by Secret Guard.');
		assert.strictEqual(next.canReturnToPlan, true);
		assert.strictEqual(next.input, COMMIT_TEXT);
	});

	test('a failed non-commit action keeps the T4 result without Back to plan', () => {
		const statusPlan = commitPlan({ intentId: 'status', commands: ['git status --short'] });
		const { deps } = fakeDeps([statusPlan], [guardResult([])], { success: false, summary: 'Checking did not finish.' });
		const state = ask(initialAssistantState(), 'what changed', deps);
		assert.strictEqual(state.guard, undefined, 'the guard only applies to commits');
		const next = confirm(state, state.previewId, deps);
		assert.strictEqual(next.canReturnToPlan, undefined);
		assert.strictEqual(backToPlan(next, deps), next);
	});

	test('T4 safeguards still hold: stale ids are ignored and changed files need a second look', () => {
		const { deps, executed } = fakeDeps(
			[commitPlan(), commitPlan({ affected: ['src/config.js', 'new.txt'] })],
			[guardResult([])]
		);
		const state = ask(initialAssistantState(), COMMIT_TEXT, deps);
		assert.strictEqual(confirm(state, state.previewId + 5, deps), state);
		const next = confirm(state, state.previewId, deps);
		assert.strictEqual(next.phase, 'preview');
		assert.strictEqual(next.notice, PLAN_CHANGED_NOTICE);
		assert.strictEqual(executed.length, 0);
	});

	// ---- rendering -----------------------------------------------------------------

	test('the blocked preview shows the reason, locations, guidance, actions and warning, with Confirm disabled', () => {
		const { deps } = fakeDeps([blockedPlan()], [guardResult([finding(), finding({ file: '.env', line: 1, snippet: 'AWS_KEY=AKIA…8R3W' })])]);
		const state = ask(initialAssistantState(), COMMIT_TEXT, deps);
		const html = renderAssistant(state);
		assert.ok(html.includes(`<h3>${BLOCKED_HEADING}</h3>`));
		assert.ok(html.includes(escapeHtml(BLOCKED_REASON)));
		assert.ok(html.includes('<li>src/config.js line 2</li>'));
		assert.ok(html.includes('<li>.env line 1</li>'));
		assert.ok(html.includes(escapeHtml(ACKNOWLEDGE_WARNING)));
		assert.ok(html.includes('<strong>Why it matters.</strong>'));
		assert.ok(html.includes('<strong>What to do next.</strong>'));
		assert.ok(html.includes('<pre class="snippet">const key = &quot;AKIA…8R3W&quot;;</pre>'));
		assert.ok(html.includes('data-action="open-file" data-file="src/config.js" data-line="2">Open file</button>'));
		assert.ok(html.includes(`data-action="safety-ack" data-key="${escapeHtml(buildIgnoreKey(finding()))}">Acknowledge</button>`));
		assert.ok(!html.includes('safety-gitignore'), 'no .gitignore action inside the Assistant');
		assert.ok(new RegExp(`data-action="assistant-confirm" data-preview-id="${state.previewId}" disabled>`).test(html));
		assert.ok(!html.includes("Can't do this yet."), 'the generic blocked line is replaced by the Secret Guard section');
	});

	test('an unblocked commit preview has no blocked section and an enabled Confirm', () => {
		const { deps } = fakeDeps([commitPlan()], [guardResult([], [finding({ severity: 'medium' })])]);
		const state = ask(initialAssistantState(), COMMIT_TEXT, deps);
		const html = renderAssistant(state);
		assert.ok(!html.includes(BLOCKED_HEADING));
		assert.ok(html.includes(`data-action="assistant-confirm" data-preview-id="${state.previewId}">Confirm</button>`));
	});

	test('"Not saved" offers Back to plan; other failures do not', () => {
		const notSaved: AssistantState = {
			input: COMMIT_TEXT,
			phase: 'done',
			previewId: 2,
			canReturnToPlan: true,
			result: { success: false, summary: NEW_SECRET_SUMMARY, details: BLOCKED_REASON }
		};
		const html = renderAssistant(notSaved);
		assert.ok(html.includes('<h2>Not saved</h2>'));
		assert.ok(html.includes(NEW_SECRET_SUMMARY));
		assert.ok(html.includes(escapeHtml(BLOCKED_REASON)));
		assert.ok(html.includes('data-action="assistant-back">Back to plan</button>'));

		const other = renderAssistant({ ...notSaved, canReturnToPlan: undefined, result: { success: false, summary: 'Uploading did not finish.' } });
		assert.ok(other.includes('<h2>Did not finish</h2>'));
		assert.ok(!other.includes('assistant-back'));
	});

	test('blocked findings are escaped everywhere, including data attributes', () => {
		const hostile = finding({ file: 'src/<img src=x>"&.js', snippet: '<script>alert(1)</script>', label: '<b>Key</b>' });
		const { deps } = fakeDeps([blockedPlan('<script>alert(2)</script>')], [guardResult([hostile])]);
		const html = renderAssistant(ask(initialAssistantState(), COMMIT_TEXT, deps));
		for (const raw of ['<script>alert(1)</script>', '<script>alert(2)</script>', '<img src=x>', '<b>Key</b>']) {
			assert.ok(!html.includes(raw), `${raw} never appears raw`);
		}
		assert.ok(html.includes('data-file="src/&lt;img src=x&gt;&quot;&amp;.js"'));
		assert.ok(!/\son[a-z]+=/i.test(html), 'no inline handlers');
	});

	// ---- real repository -----------------------------------------------------------

	test('real repo: blocked by a key, unblocked only by an explicit acknowledgement, then committed', async () => {
		const repo = makeTempRepo();
		writeFile(repo, 'src/config.js', `const a = 1;\nconst key = "${FAKE_AWS_KEY}";\n`);
		const { store, calls } = spyStore();
		const deps: AssistantDeps = {
			cwd: repo,
			readSnapshot: () => getRepoSnapshot(repo),
			buildPlan: (match, cwd, snapshot) => buildActionPlan(match, cwd, snapshot, { acknowledged: store }),
			execute: (match, cwd) => executeAction(match, cwd, { acknowledged: store }),
			checkGuard: cwd => checkCommitGuard(cwd, store)
		};

		const blocked = ask(initialAssistantState(), 'Save my changes: add key', deps);
		assert.strictEqual(blocked.guard?.blocked, true);
		assert.deepStrictEqual(blocked.guard?.findings.map(f => `${f.file}:${f.line}`), ['src/config.js:2']);
		const html = renderAssistant(blocked);
		assert.ok(!html.includes(FAKE_AWS_KEY), 'the full key is never rendered');
		assert.ok(html.includes('AKIA…8R3W'));
		assert.strictEqual(confirm(blocked, blocked.previewId, deps).result?.success, false, 'a forced confirm does not commit');
		assert.strictEqual(git(repo, 'rev-list', '--count', 'HEAD'), '1');
		assert.deepStrictEqual(calls, [], 'nothing was acknowledged automatically');

		await store.acknowledge(blocked.guard!.findings[0].key);
		const unblocked = refreshPreview(blocked, deps);
		assert.strictEqual(unblocked.guard?.blocked, false);
		assert.strictEqual(canConfirm(unblocked.plan, unblocked.guard), true);

		const done = confirm(unblocked, unblocked.previewId, deps);
		assert.strictEqual(done.result?.success, true, done.result?.details);
		assert.strictEqual(git(repo, 'log', '-1', '--format=%s'), 'add key');
	});
});
