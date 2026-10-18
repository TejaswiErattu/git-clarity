import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { SUPPORTED_INTENTS } from '../assistant/intentMatcher';
import { createInMemoryAcknowledgedStore, MementoLike } from '../safety/secretGuard';
import { initialAssistantState } from '../ui/assistantController';
import { hasSeenHelp, HELP_SEEN_KEY, markHelpSeen, resetHelpSeen } from '../ui/firstRun';
import { DashboardState, renderDashboardHtml, TABS } from '../ui/render';
import { exampleFor, renderHelpOverlay, TAB_HELP } from '../ui/render/help';
import { escapeHtml } from '../ui/render/html';
import { RepoSnapshot } from '../git/types';

const JARGON = /\b(upstream|working tree|stash|HEAD|index|staging area|rebase|origin|fast-forward|SHA)\b/;

/** Visible text only: tags removed and the common entities decoded. */
function visibleText(html: string): string {
	return html
		.replace(/<[^>]+>/g, ' ')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

function memento(): MementoLike & { data: Map<string, unknown> } {
	const data = new Map<string, unknown>();
	return {
		data,
		get: <T>(key: string, defaultValue: T): T => (data.has(key) && data.get(key) !== undefined ? (data.get(key) as T) : defaultValue),
		update: async (key: string, value: unknown) => {
			data.set(key, value);
		}
	};
}

function snapshot(): RepoSnapshot {
	return {
		isRepo: true,
		repoName: 'demo',
		currentBranch: 'main',
		isDetached: false,
		hasCommits: true,
		defaultBranch: 'main',
		branches: [{ name: 'main', isCurrent: true }],
		branchSummaries: [],
		commits: [],
		changedFileCount: 0,
		changedFiles: [],
		aheadBehind: { ahead: 0, behind: 0, hasUpstream: false },
		filesTouched: []
	};
}

function page(overrides: Partial<DashboardState> = {}): string {
	const state: DashboardState = { snapshot: snapshot(), activeTab: 'overview', assistant: initialAssistantState(), acknowledgedCount: 0, ...overrides };
	return renderDashboardHtml(state, 'nonce-1', 'vscode-webview://test');
}

suite('First-run help overlay (T6)', () => {
	test('every supported request appears with its example and description, generated from SUPPORTED_INTENTS', () => {
		const html = renderHelpOverlay(true);
		assert.ok(SUPPORTED_INTENTS.length > 0);
		for (const intent of SUPPORTED_INTENTS) {
			assert.ok(html.includes(`<strong>${escapeHtml(intent.title)}</strong>`), `${intent.id} title`);
			assert.ok(html.includes(`<code>${escapeHtml(exampleFor(intent))}</code>`), `${intent.id} example`);
			assert.ok(html.includes(escapeHtml(intent.description)), `${intent.id} description`);
		}
		assert.strictEqual((html.match(/class="help-intent"/g) ?? []).length, SUPPORTED_INTENTS.length);
	});

	test('examples that need more words end in an ellipsis; complete ones do not', () => {
		for (const intent of SUPPORTED_INTENTS) {
			const example = exampleFor(intent);
			assert.strictEqual(example.endsWith('…'), !intent.chip.autoSubmit, intent.id);
			assert.ok(example.startsWith(intent.chip.insertText.trim()), intent.id);
		}
	});

	test('a closed overlay renders nothing, and the page has no dialog unless help is open', () => {
		assert.strictEqual(renderHelpOverlay(false), '');
		assert.ok(!page().includes('class="help-dialog"'));
		assert.ok(!page({ helpOpen: false }).includes('class="help-dialog"'));
		assert.ok(page({ helpOpen: true }).includes('class="help-dialog"'));
	});

	test('the open overlay explains all five tabs and is an accessible dialog', () => {
		const html = renderHelpOverlay(true);
		assert.deepStrictEqual(TAB_HELP.map(t => t.id), TABS.map(t => t.id), 'one entry per tab, in tab order');
		for (const tab of TAB_HELP) {
			assert.ok(html.includes(`<dt>${tab.label}</dt><dd>${escapeHtml(tab.text)}</dd>`), tab.id);
		}
		assert.ok(html.includes('role="dialog"'));
		assert.ok(html.includes('aria-modal="true"'));
		assert.ok(html.includes('aria-labelledby="help-title"'));
		assert.ok(html.includes('<h2 id="help-title">Welcome to Git Clarity</h2>'));
		assert.ok(html.includes('aria-describedby="help-intro"'));
		assert.ok(html.includes('data-action="hide-help" aria-label="Close help"'));
		assert.ok(html.includes('<button class="primary" data-action="hide-help">Got it</button>'));
	});

	test('help text has no unexplained jargon, including the generated request list', () => {
		const text = visibleText(renderHelpOverlay(true));
		const hit = JARGON.exec(text);
		assert.strictEqual(hit, null, `found jargon: ${hit?.[0]}`);
		assert.ok(/commit is a saved checkpoint/.test(text), 'commit is explained');
		assert.ok(/branch is a separate line of work/.test(text), 'branch is explained');
	});

	test('intent text is escaped and there are no inline handlers', () => {
		const hostile = [{
			title: '<script>alert(1)</script>',
			description: '<img src=x>"&\'',
			chip: { label: 'x', insertText: '<b>do it</b>', autoSubmit: false }
		}];
		const html = renderHelpOverlay(true, hostile);
		for (const raw of ['<script>alert(1)</script>', '<img src=x>', '<b>do it</b>']) {
			assert.ok(!html.includes(raw), `${raw} never appears raw`);
		}
		assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
		assert.ok(html.includes('<code>&lt;b&gt;do it&lt;/b&gt; …</code>'));
		assert.ok(!/\son[a-z]+=/i.test(page({ helpOpen: true })), 'no inline handlers anywhere on the page');
	});

	test('first-run flag: unseen at first, seen once dismissed, unseen again after reset', async () => {
		assert.strictEqual(HELP_SEEN_KEY, 'gitClarity.helpSeen');
		const m = memento();
		assert.strictEqual(hasSeenHelp(m), false);
		await markHelpSeen(m);
		assert.strictEqual(m.data.get('gitClarity.helpSeen'), true);
		assert.strictEqual(hasSeenHelp(m), true);
		await resetHelpSeen(m);
		assert.strictEqual(hasSeenHelp(m), false);
	});

	test('the first-run flag does not touch Secret Guard acknowledgements in the same workspaceState', async () => {
		const m = memento();
		const store = createInMemoryAcknowledgedStore(['a|b|c']);
		await markHelpSeen(m);
		await resetHelpSeen(m);
		assert.deepStrictEqual(store.keys(), ['a|b|c']);
		assert.deepStrictEqual([...m.data.keys()], ['gitClarity.helpSeen']);
	});

	test('the dashboard keeps its header, tabs and Assistant under the overlay', () => {
		const closed = page();
		assert.ok(closed.includes('data-action="show-help" aria-label="Open help" title="Help">?</button>'));
		assert.ok(closed.includes('data-action="refresh">Refresh</button>'));
		for (const tab of TABS) {
			assert.ok(closed.includes(`data-tab="${tab.id}"`), tab.id);
		}
		const assistantWithHelp = page({ activeTab: 'assistant', helpOpen: true });
		assert.ok(assistantWithHelp.includes('data-input="assistant"'), 'the Assistant composer still renders');
		assert.ok(assistantWithHelp.includes('data-action="assistant-ask"'));
		assert.ok(assistantWithHelp.indexOf('class="help-dialog"') > assistantWithHelp.indexOf('data-input="assistant"'), 'the overlay sits on top of the page');
		const noFolder = page({ snapshot: undefined, helpOpen: true });
		assert.ok(noFolder.includes('Open a folder to get started'));
		assert.ok(noFolder.includes('data-action="show-help"'), 'help is reachable from empty states too');
		assert.ok(noFolder.includes('class="help-dialog"'));
	});

	test('package.json contributes the dashboard and reset commands', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
		const commands: Array<{ command: string; title: string }> = pkg.contributes.commands;
		assert.deepStrictEqual(commands.map(c => c.command), ['gitClarity.openDashboard', 'gitClarity.resetFirstRun']);
		assert.strictEqual(commands[1].title, 'Git Clarity: Reset first-run help');
	});
});
