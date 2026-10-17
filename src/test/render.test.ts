import * as assert from 'assert';
import { getRepoSnapshot } from '../git/gitCommands';
import { ChangedFile, RepoSnapshot } from '../git/types';
import { initialAssistantState } from '../ui/assistantController';
import { DashboardState, renderDashboardHtml, TabId, TABS } from '../ui/render';
import { escapeHtml } from '../ui/render/html';
import { describeStatus, MAX_OVERVIEW_FILES } from '../ui/render/overview';
import { cleanupTempDirs, isolateGitEnv, makeTempRepo, writeFile } from './helpers/tempRepo';

const NONCE = 'test-nonce-123';

function makeSnapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
	const changedFiles: ChangedFile[] = overrides.changedFiles ?? [{ path: 'src/app.ts', status: ' M' }];
	return {
		isRepo: true,
		repoName: 'demo-repo',
		currentBranch: 'feature/login',
		isDetached: false,
		hasCommits: true,
		defaultBranch: 'main',
		branches: [
			{ name: 'main', isCurrent: false },
			{ name: 'feature/login', isCurrent: true }
		],
		branchSummaries: [],
		commits: [{ hash: 'abc123', message: 'Initial commit', author: 'Test User', time: '2 hours ago' }],
		changedFileCount: changedFiles.length,
		changedFiles,
		aheadBehind: { ahead: 0, behind: 0, hasUpstream: false },
		filesTouched: [],
		...overrides
	};
}

function makeState(overrides: Partial<DashboardState> = {}): DashboardState {
	return { snapshot: makeSnapshot(), activeTab: 'overview', assistant: initialAssistantState(), acknowledgedCount: 0, ...overrides };
}

function render(overrides: Partial<DashboardState> = {}): string {
	return renderDashboardHtml(makeState(overrides), NONCE, 'vscode-webview://test');
}

function selectedTabs(html: string): TabId[] {
	return [...html.matchAll(/data-tab="([a-z]+)" aria-selected="true"/g)].map(m => m[1] as TabId);
}

suite('render: dashboard HTML', () => {
	suiteSetup(isolateGitEnv);
	suiteTeardown(cleanupTempDirs);

	test('all five tabs render their heading and only the active tab is selected', () => {
		const headings: Record<TabId, string> = {
			overview: 'Changed files',
			branches: 'Branches',
			activity: 'Recent activity',
			assistant: 'Assistant',
			safety: 'Secret Guard'
		};
		assert.strictEqual(TABS.length, 5);
		for (const tab of TABS) {
			const html = render({ activeTab: tab.id });
			assert.ok(html.includes(`<h2>${headings[tab.id]}</h2>`), `${tab.id} shows its heading`);
			assert.deepStrictEqual(selectedTabs(html), [tab.id], `${tab.id} is the only selected tab`);
			for (const other of TABS) {
				assert.ok(html.includes(`data-tab="${other.id}"`), `${other.id} button is present on the ${tab.id} tab`);
			}
		}
	});

	test('no workspace folder shows an "open a folder" empty state without a tab bar', () => {
		const html = render({ snapshot: undefined });
		assert.ok(html.includes('Open a folder to get started'));
		assert.ok(!html.includes('role="tablist"'));
	});

	test('a folder that is not a Git repository is named in a friendly empty state', () => {
		const html = render({ snapshot: makeSnapshot({ isRepo: false, repoName: 'my-notes', currentBranch: '' }) });
		assert.ok(html.includes('my-notes is not a Git repository yet'));
		assert.ok(!html.includes('role="tablist"'));
	});

	test('a repository without commits says so and still lists its untracked files', () => {
		const snapshot = makeSnapshot({ hasCommits: false, commits: [], changedFiles: [{ path: 'first.txt', status: '??' }] });
		const html = render({ snapshot });
		assert.ok(html.includes('No commits yet'));
		assert.ok(html.includes('role="tablist"'), 'tabs are still available');
		assert.ok(html.includes('first.txt'));
		assert.ok(html.includes('New file (not tracked yet)'));
	});

	test('overview shows repository name, branch, changed-file count and friendly labels', () => {
		const html = render();
		assert.ok(html.includes('demo-repo'));
		assert.ok(html.includes('feature/login'));
		assert.ok(html.includes('<div class="value">1</div>'));
		assert.ok(html.includes('src/app.ts'));
		assert.ok(html.includes('<span class="badge">Edited</span>'));
		assert.ok(!html.includes('staged'), 'no Git jargon on the overview');
	});

	test('overview lists at most eight changed files and counts the rest', () => {
		const changedFiles = Array.from({ length: 10 }, (_, i) => ({ path: `file-${i}.txt`, status: ' M' }));
		const html = render({ snapshot: makeSnapshot({ changedFiles }) });
		for (let i = 0; i < MAX_OVERVIEW_FILES; i++) {
			assert.ok(html.includes(`file-${i}.txt`), `file-${i} is listed`);
		}
		assert.ok(!html.includes('file-8.txt'));
		assert.ok(!html.includes('file-9.txt'));
		assert.ok(html.includes('and 2 more'));
	});

	test('overview explains ahead/behind and a clean tree in plain words', () => {
		const synced = render({ snapshot: makeSnapshot({ changedFiles: [], aheadBehind: { ahead: 0, behind: 0, hasUpstream: true } }) });
		assert.ok(synced.includes('In sync with the remote'));
		assert.ok(synced.includes('Nothing has changed since your last save'));
		const diverged = render({ snapshot: makeSnapshot({ aheadBehind: { ahead: 2, behind: 1, hasUpstream: true } }) });
		assert.ok(diverged.includes('2 to push, 1 to pull'));
		const detached = render({ snapshot: makeSnapshot({ isDetached: true, currentBranch: 'abc1234 (detached)' }) });
		assert.ok(detached.includes('Not on a branch right now'));
	});

	test('porcelain status codes become beginner-friendly labels', () => {
		const cases: Array<[string, string]> = [
			['??', 'New file (not tracked yet)'],
			['A ', 'New file, ready to save'],
			['AM', 'New file, ready to save'],
			[' M', 'Edited'],
			['M ', 'Edited, ready to save'],
			['MM', 'Edited (part is ready to save)'],
			[' D', 'Deleted'],
			['D ', 'Deleted'],
			['R ', 'Renamed'],
			['RM', 'Renamed'],
			['C ', 'Copied'],
			['UU', 'Conflict, needs your attention'],
			['AA', 'Conflict, needs your attention'],
			['DD', 'Conflict, needs your attention'],
			['T ', 'Changed']
		];
		for (const [code, label] of cases) {
			assert.strictEqual(describeStatus(code), label, `status ${JSON.stringify(code)}`);
		}
	});

	test('a real repository snapshot renders its real name, branch and edited file', () => {
		const repo = makeTempRepo();
		writeFile(repo, 'README.md', 'changed\n');
		const snapshot = getRepoSnapshot(repo);
		const html = render({ snapshot });
		assert.ok(html.includes(escapeHtml(snapshot.repoName)));
		assert.ok(!html.includes('demo-repo'), 'the fixture name is not used');
		assert.ok(html.includes('main'));
		assert.ok(html.includes('README.md'));
		assert.ok(html.includes('<span class="badge">Edited</span>'));
	});

	test('repository-derived text is escaped so it cannot inject markup', () => {
		const hostile = '<script>alert(1)</script>';
		const snapshot = makeSnapshot({
			repoName: 'repo "quoted" & <b>bold</b>',
			currentBranch: hostile,
			changedFiles: [{ path: 'a&b"c<d>.txt', status: '??' }]
		});
		for (const tab of TABS) {
			const html = render({ snapshot, activeTab: tab.id });
			assert.ok(!html.includes(hostile), `${tab.id}: raw script tag never appears`);
			assert.ok(!html.includes('<b>bold</b>'), `${tab.id}: raw markup never appears`);
		}
		const html = render({ snapshot });
		assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
		assert.ok(html.includes('a&amp;b&quot;c&lt;d&gt;.txt'));
		assert.ok(html.includes('repo &quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt;'));
	});

	test('the page carries a nonce-based CSP and no inline event handlers', () => {
		const html = render();
		assert.ok(html.includes(`script-src 'nonce-${NONCE}'`));
		assert.ok(html.includes(`style-src vscode-webview://test 'nonce-${NONCE}'`));
		assert.ok(html.includes("default-src 'none'"));
		assert.ok(html.includes(`<script nonce="${NONCE}">`));
		assert.ok(html.includes(`<style nonce="${NONCE}">`));
		assert.ok(!/\son[a-z]+=/i.test(html), 'no on*= attributes');
		assert.ok(html.includes('data-action="refresh"'));
	});

	test('the assistant input keeps what was typed, escaped', () => {
		const html = render({ activeTab: 'assistant', assistant: { ...initialAssistantState(), input: 'save my "changes" <now>' } });
		assert.ok(html.includes('data-input="assistant"'));
		assert.ok(html.includes('value="save my &quot;changes&quot; &lt;now&gt;"'));
		assert.ok(!html.includes('value="save my "changes"'));
	});

	test('the safety tab reports the acknowledged count with the right plural', () => {
		assert.ok(render({ activeTab: 'safety', acknowledgedCount: 1 }).includes('1 acknowledged finding in'));
		assert.ok(render({ activeTab: 'safety', acknowledgedCount: 3 }).includes('3 acknowledged findings in'));
	});
});
