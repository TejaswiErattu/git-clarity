import * as assert from 'assert';
import { matchIntent, SUPPORTED_INTENTS } from '../assistant/intentMatcher';
import { ActionPlan, buildActionPlan, GitActionResult, RiskLevel } from '../git/gitActions';
import { getRepoSnapshot } from '../git/gitCommands';
import { createInMemoryAcknowledgedStore } from '../safety/secretGuard';
import { AssistantState, initialAssistantState } from '../ui/assistantController';
import { NOTHING_RUNS_LINE, renderAssistant, riskReason } from '../ui/render/assistant';
import { cleanupTempDirs, isolateGitEnv, makeTempRepo, writeFile } from './helpers/tempRepo';

function makePlan(overrides: Partial<ActionPlan> = {}): ActionPlan {
	return {
		intentId: 'commit',
		title: 'Save your changes (commit)',
		commands: ['git add -A', 'git commit -m "fix navbar"'],
		explanation: 'A commit is a saved checkpoint of your work.',
		affected: ['src/navbar.ts', 'README.md'],
		risk: 'careful',
		reversible: true,
		undoHint: 'Ask "Undo my last commit" to undo it.',
		warnings: ['Check the files before saving.'],
		...overrides
	};
}

function previewState(plan: ActionPlan, overrides: Partial<AssistantState> = {}): AssistantState {
	return {
		input: 'save my changes: fix navbar',
		phase: 'preview',
		match: matchIntent('save my changes: fix navbar'),
		plan,
		previewId: 7,
		...overrides
	};
}

function doneState(result: GitActionResult): AssistantState {
	return { input: '', phase: 'done', result, previewId: 3 };
}

const CONFIRM_ENABLED = 'data-action="assistant-confirm" data-preview-id="7">Confirm</button>';
const CONFIRM_DISABLED = 'data-action="assistant-confirm" data-preview-id="7" disabled>Confirm</button>';

suite('render: Assistant tab', () => {
	suiteSetup(isolateGitEnv);
	suiteTeardown(cleanupTempDirs);

	test('idle shows the input, Ask, the confirm promise and one chip per supported intent', () => {
		const html = renderAssistant(initialAssistantState());
		assert.ok(html.includes('data-input="assistant"'));
		assert.ok(html.includes('data-action="assistant-ask"'));
		assert.ok(html.includes(NOTHING_RUNS_LINE));
		const chips = [...html.matchAll(/class="chip" data-chip-text="([^"]*)" data-chip-submit="(true|false)"/g)];
		assert.strictEqual(chips.length, SUPPORTED_INTENTS.length);
		assert.strictEqual(chips.length, 9);
		SUPPORTED_INTENTS.forEach((intent, i) => {
			assert.ok(html.includes(`>${intent.chip.label}</button>`), `${intent.id} chip label`);
			assert.strictEqual(chips[i][2], String(intent.chip.autoSubmit), `${intent.id} auto-submit flag`);
		});
		assert.ok(!html.includes('assistant-confirm'), 'no Confirm button before a preview');
	});

	test('a preview shows commands, explanation, affected files, warnings, undo, Confirm and Cancel', () => {
		const html = renderAssistant(previewState(makePlan()));
		assert.ok(html.includes('<h2>Save your changes (commit)</h2>'));
		assert.ok(html.includes('<pre class="commands"><code>git add -A\ngit commit -m &quot;fix navbar&quot;</code></pre>'));
		assert.ok(html.includes('A commit is a saved checkpoint of your work.'));
		assert.ok(html.includes('<li>src/navbar.ts</li>'));
		assert.ok(html.includes('<li>README.md</li>'));
		assert.ok(html.includes('<li>Check the files before saving.</li>'));
		assert.ok(html.includes('Ask &quot;Undo my last commit&quot; to undo it.'));
		assert.ok(html.includes(CONFIRM_ENABLED));
		assert.ok(html.includes('data-action="assistant-cancel">Cancel</button>'));
		assert.ok(html.includes(NOTHING_RUNS_LINE), 'the composer stays above the preview');
	});

	test('each risk level shows its Safe / Careful / Risky badge and a reason', () => {
		const cases: Array<[RiskLevel, string]> = [['safe', 'Safe'], ['careful', 'Careful'], ['risky', 'Risky']];
		for (const [risk, label] of cases) {
			const plan = makePlan({ risk });
			const html = renderAssistant(previewState(plan));
			assert.ok(html.includes(`<span class="risk risk-${risk}">${label}</span>`), `${risk} badge`);
			assert.ok(html.includes(riskReason(plan)), `${risk} reason`);
		}
	});

	test('risk reasons depend on risk and reversibility', () => {
		assert.strictEqual(riskReason({ risk: 'safe', reversible: true }), 'This only reads information or is easy to reverse.');
		assert.strictEqual(riskReason({ risk: 'careful', reversible: true }), 'This changes your project, but it can be undone.');
		assert.strictEqual(riskReason({ risk: 'careful', reversible: false }), 'This changes something that is hard to take back.');
		assert.strictEqual(riskReason({ risk: 'risky', reversible: true }), 'This could clash with work you have not saved yet.');
		assert.strictEqual(riskReason({ risk: 'risky', reversible: false }), 'This cannot be undone. Read the warnings below first.');
	});

	test('a blocked plan shows the reason and disables Confirm', () => {
		const plan = makePlan({ blockedReason: 'src/config.js line 3 looks like a AWS access key.' });
		const html = renderAssistant(previewState(plan));
		assert.ok(html.includes('class="blocked"'));
		assert.ok(html.includes('src/config.js line 3 looks like a AWS access key.'));
		assert.ok(html.includes(CONFIRM_DISABLED));
		assert.ok(!html.includes(CONFIRM_ENABLED));
	});

	test('a plan with no commands says nothing will run and disables Confirm', () => {
		const html = renderAssistant(previewState(makePlan({ commands: [], blockedReason: 'There is nothing to save.' })));
		assert.ok(html.includes('Nothing will run.'));
		assert.ok(html.includes(CONFIRM_DISABLED));
	});

	test('notices and medium-confidence guesses are shown above the plan', () => {
		const html = renderAssistant(previewState(makePlan(), {
			notice: 'Your project changed since this preview.',
			match: matchIntent('commit stuff')
		}));
		assert.ok(html.includes('<p class="notice">Your project changed since this preview.</p>'));
		assert.ok(html.includes('Best guess from keywords'));
	});

	test('an unrecognized request lists every supported action and offers no Confirm', () => {
		const html = renderAssistant({ input: 'make me a sandwich', phase: 'unrecognized', previewId: 0 });
		assert.ok(html.includes(`I don't recognize "make me a sandwich" yet, so I won't guess.`));
		for (const intent of SUPPORTED_INTENTS) {
			assert.ok(html.includes(`<strong>${intent.title}</strong>`), `${intent.id} is listed`);
		}
		assert.ok(!html.includes('assistant-confirm'));
	});

	test('results show success and failure summaries with details', () => {
		const ok = renderAssistant(doneState({ success: true, summary: 'Your changes are saved.', details: 'Commit message: "x"' }));
		assert.ok(ok.includes('<h2>Done</h2>'));
		assert.ok(ok.includes('<p class="result-ok">Your changes are saved.</p>'));
		assert.ok(ok.includes('<pre class="result-details">Commit message: &quot;x&quot;</pre>'));
		assert.ok(ok.includes('Ask something else'));

		const fail = renderAssistant(doneState({ success: false, summary: 'Uploading your changes did not finish.', details: 'Git said: rejected' }));
		assert.ok(fail.includes('<h2>Did not finish</h2>'));
		assert.ok(fail.includes('<p class="result-fail">Uploading your changes did not finish.</p>'));
		assert.ok(fail.includes('Git said: rejected'));
		assert.ok(!fail.includes('assistant-confirm'));
	});

	test('user and repository text is escaped everywhere and there are no inline handlers', () => {
		const hostile = '<script>alert(1)</script>';
		const plan = makePlan({
			commands: [`git commit -m "${hostile}"`],
			affected: ['a&b"c<d>.txt', `feature/"x"&<y>`],
			warnings: [hostile],
			blockedReason: hostile
		});
		const pages = [
			renderAssistant(previewState(plan, { input: hostile, notice: hostile })),
			renderAssistant({ input: hostile, phase: 'unrecognized', previewId: 0 }),
			renderAssistant(doneState({ success: false, summary: hostile, details: hostile }))
		];
		for (const html of pages) {
			assert.ok(!html.includes(hostile), 'raw script tag never appears');
			assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
			assert.ok(!/\son[a-z]+=/i.test(html), 'no on*= attributes');
		}
		assert.ok(pages[0].includes('<li>a&amp;b&quot;c&lt;d&gt;.txt</li>'));
		assert.ok(pages[0].includes('<li>feature/&quot;x&quot;&amp;&lt;y&gt;</li>'));
	});

	test('a real commit plan from buildActionPlan renders its escaped command and files', () => {
		const repo = makeTempRepo();
		writeFile(repo, 'notes.txt', 'hello\n');
		const match = matchIntent('Save my changes: fix <b>bold</b>');
		const plan = buildActionPlan(match, repo, getRepoSnapshot(repo), { acknowledged: createInMemoryAcknowledgedStore() });
		assert.ok(plan, 'a plan is built');
		const html = renderAssistant(previewState(plan, { match }));
		assert.ok(html.includes('git commit -m &quot;fix &lt;b&gt;bold&lt;/b&gt;&quot;'));
		assert.ok(html.includes('<li>notes.txt</li>'));
		assert.ok(html.includes('<span class="risk risk-careful">Careful</span>'));
		assert.ok(html.includes(CONFIRM_ENABLED));
	});
});
