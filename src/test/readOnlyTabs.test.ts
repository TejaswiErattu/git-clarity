import * as assert from 'assert';
import { getRepoSnapshot } from '../git/gitCommands';
import { BranchSummary, ChangedFile, CommitInfo, RepoSnapshot } from '../git/types';
import { renderActivity } from '../ui/render/activity';
import { compareSentence, renderBranches } from '../ui/render/branches';
import {
	describeChange,
	formatClock,
	formatDayLabel,
	groupCommitsByDay,
	orderBranches,
	overlappingFiles,
	syncStatus
} from '../ui/render/format';
import { renderOverview, stageSummary } from '../ui/render/overview';
import { cleanupTempDirs, commitFile, git, isolateGitEnv, makeTempRepo, writeFile } from './helpers/tempRepo';

/** Fixed "now": Fri Oct 17 2026, 3:00 PM local time. */
const NOW = new Date(2026, 9, 17, 15, 0);
const localIso = (y: number, m: number, d: number, h = 10, min = 30) => new Date(y, m, d, h, min).toISOString();

function commit(overrides: Partial<CommitInfo> = {}): CommitInfo {
	return { hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', message: 'Add login form', author: 'Sam', time: '2 hours ago', date: localIso(2026, 9, 17), ...overrides };
}

function branch(overrides: Partial<BranchSummary> = {}): BranchSummary {
	return { name: 'feature/login', isCurrent: false, isDefault: false, lastCommit: commit(), commitsAhead: 0, commitsBehind: 0, filesChanged: [], ...overrides };
}

function snapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
	const changedFiles: ChangedFile[] = overrides.changedFiles ?? [];
	return {
		isRepo: true,
		repoName: 'demo',
		currentBranch: 'main',
		isDetached: false,
		hasCommits: true,
		defaultBranch: 'main',
		branches: [],
		branchSummaries: [branch({ name: 'main', isCurrent: true, isDefault: true })],
		commits: [commit()],
		changedFileCount: changedFiles.length,
		changedFiles,
		aheadBehind: { ahead: 0, behind: 0, hasUpstream: true },
		filesTouched: ['src/login.ts'],
		...overrides
	};
}

const JARGON = /\b(upstream|working tree|stash|HEAD)\b/;

suite('Read-only tabs (T5): Overview, Branches, Activity', () => {
	suiteSetup(isolateGitEnv);
	suiteTeardown(cleanupTempDirs);

	// ---- sync status ---------------------------------------------------------------

	test('sync status covers detached, local-only, in sync, ahead, behind and both, in plain words', () => {
		const ab = (ahead: number, behind: number, hasUpstream = true) => ({ isDetached: false, aheadBehind: { ahead, behind, hasUpstream } });
		assert.strictEqual(syncStatus({ isDetached: true, aheadBehind: { ahead: 0, behind: 0, hasUpstream: true } }).headline, 'Not on a branch right now.');
		assert.strictEqual(syncStatus(ab(0, 0, false)).headline, 'Only on this computer.');
		assert.strictEqual(syncStatus(ab(0, 0)).headline, 'In sync with the remote.');
		assert.strictEqual(syncStatus(ab(0, 0)).tone, 'ok');
		assert.strictEqual(syncStatus(ab(1, 0)).headline, '1 commit to upload.');
		assert.match(syncStatus(ab(1, 0)).detail, /Uploading \(push\) shares it\./);
		assert.strictEqual(syncStatus(ab(3, 0)).headline, '3 commits to upload.');
		assert.strictEqual(syncStatus(ab(0, 2)).headline, '2 commits to download.');
		assert.match(syncStatus(ab(0, 2)).detail, /Downloading \(pull\) brings them in\./);
		assert.strictEqual(syncStatus(ab(2, 1)).headline, '2 commits to upload and 1 to download.');
		assert.strictEqual(syncStatus(ab(2, 1)).tone, 'warn');
		for (const s of [syncStatus(ab(0, 0, false)), syncStatus(ab(2, 1)), syncStatus({ isDetached: true, aheadBehind: { ahead: 0, behind: 0, hasUpstream: false } })]) {
			assert.ok(!JARGON.test(s.headline + s.detail), `no jargon in: ${s.headline}`);
		}
	});

	// ---- changed files -------------------------------------------------------------

	test('porcelain codes map to a readable kind and a staged / not staged state', () => {
		const cases: Array<[string, string, string]> = [
			['??', 'Untracked', 'untracked'],
			['A ', 'Added', 'staged'],
			['AM', 'Added', 'partly'],
			[' M', 'Modified', 'unstaged'],
			['M ', 'Modified', 'staged'],
			['MM', 'Modified', 'partly'],
			[' D', 'Deleted', 'unstaged'],
			['D ', 'Deleted', 'staged'],
			['R ', 'Renamed', 'staged'],
			['RM', 'Renamed', 'partly'],
			['C ', 'Copied', 'staged'],
			['UU', 'Conflict', 'conflict'],
			['AA', 'Conflict', 'conflict'],
			['DD', 'Conflict', 'conflict']
		];
		for (const [code, kind, stage] of cases) {
			assert.deepStrictEqual(describeChange(code), { kind, stage }, `status ${JSON.stringify(code)}`);
		}
	});

	test('Overview shows the sync card, kind badges, stage tags, a count summary and a legend', () => {
		const changedFiles = [
			{ path: 'staged.txt', status: 'A ' },
			{ path: 'edited.txt', status: ' M' },
			{ path: 'both.txt', status: 'MM' },
			{ path: 'new.txt', status: '??' },
			{ path: 'gone.txt', status: ' D' }
		];
		const html = renderOverview(snapshot({ changedFiles, aheadBehind: { ahead: 1, behind: 0, hasUpstream: true } }));
		assert.ok(html.includes('<div class="sync tone-info"><strong>1 commit to upload.</strong>'));
		assert.ok(html.includes('<code class="path">staged.txt</code><span class="tags"><span class="badge">Added</span><span class="stage stage-staged">Staged</span>'));
		assert.ok(html.includes('<span class="badge">Modified</span><span class="stage stage-unstaged">Not staged</span>'));
		assert.ok(html.includes('<span class="stage stage-partly">Partly staged</span>'));
		assert.ok(html.includes('<span class="badge">Untracked</span><span class="stage stage-untracked">Untracked</span>'));
		assert.ok(html.includes('<span class="badge">Deleted</span>'));
		assert.strictEqual(stageSummary(changedFiles), '1 staged · 1 partly staged · 2 not staged · 1 untracked');
		assert.ok(html.includes('ready to go into your next commit'));
		assert.ok(html.includes('a new file Git is not keeping track of yet'));
		assert.ok(html.includes('5 files not saved to Git yet'));
		assert.ok(!JARGON.test(html), 'no unexplained jargon');
	});

	test('Overview with no changes shows a friendly empty state and no legend', () => {
		const html = renderOverview(snapshot());
		assert.ok(html.includes('Nothing has changed since your last save'));
		assert.ok(html.includes('Everything is saved'));
		assert.ok(!html.includes('class="legend"'));
	});

	test('Overview truncates long lists but counts every file in the summary', () => {
		const changedFiles = Array.from({ length: 10 }, (_, i) => ({ path: `f${i}.txt`, status: i < 4 ? 'M ' : '??' }));
		const html = renderOverview(snapshot({ changedFiles }));
		assert.ok(html.includes('…and 2 more'));
		assert.ok(html.includes('4 staged · 6 untracked'));
	});

	// ---- branches ------------------------------------------------------------------

	test('branch comparisons are explained in plain English', () => {
		assert.strictEqual(compareSentence(branch({ isDefault: true, name: 'main' }), 'main'), 'This is the main line of work. Other branches are compared with it.');
		assert.strictEqual(compareSentence(branch({ commitsAhead: 2 }), 'main'), '2 commits only on this branch (not on main yet).');
		assert.strictEqual(compareSentence(branch({ commitsBehind: 1 }), 'main'), '1 commit on main that this branch doesn\'t have yet.');
		assert.strictEqual(
			compareSentence(branch({ commitsAhead: 1, commitsBehind: 3 }), 'master'),
			'1 commit only on this branch (not on master yet). 3 commits on master that this branch doesn\'t have yet.'
		);
		assert.strictEqual(compareSentence(branch(), 'main'), 'Has the same commits as main.');
	});

	test('Branches tab tags the current and main branches, orders them, and shows last commit and files', () => {
		const summaries = [
			branch({ name: 'zeta', commitsAhead: 1, filesChanged: ['z.ts'] }),
			branch({ name: 'main', isDefault: true }),
			branch({ name: 'feature/login', isCurrent: true, commitsAhead: 2, commitsBehind: 1, filesChanged: ['src/login.ts', 'src/app.ts'] })
		];
		assert.deepStrictEqual(orderBranches(summaries).map(b => b.name), ['feature/login', 'main', 'zeta']);
		const html = renderBranches(snapshot({ currentBranch: 'feature/login', branchSummaries: summaries }));
		assert.ok(html.includes('<h3>feature/login</h3><span class="tag tag-current">You are here</span>'));
		assert.ok(html.includes('<h3>main</h3><span class="tag tag-default">Main branch</span>'));
		assert.ok(html.includes('3 branches in this project. You are on <strong>feature/login</strong>.'));
		assert.ok(html.includes('2 commits only on this branch (not on main yet). 1 commit on main that this branch doesn&#39;t have yet.') ||
			html.includes('2 commits only on this branch (not on main yet). 1 commit on main that this branch doesn\'t have yet.'));
		assert.ok(html.includes('Last commit: “Add login form” by Sam, 2 hours ago'));
		assert.ok(html.includes('title="Commit a1b2c3d"'));
		assert.ok(!html.includes('>a1b2c3d'), 'the hash is not in visible text');
		assert.ok(html.includes('<li><code class="path">src/login.ts</code></li>'));
		assert.ok(html.includes('Counts only'));
		assert.ok(!html.includes('These files are changed on more than one branch'));
	});

	test('a file changed on two non-default branches triggers the overlap warning; the main branch does not count', () => {
		const summaries = [
			branch({ name: 'main', isDefault: true, isCurrent: true, filesChanged: ['README.md'] }),
			branch({ name: 'feature/a', filesChanged: ['src/app.ts', 'README.md'] }),
			branch({ name: 'feature/b', filesChanged: ['src/app.ts', 'docs/b.md'] })
		];
		assert.deepStrictEqual(overlappingFiles(summaries), [{ file: 'src/app.ts', branches: ['feature/a', 'feature/b'] }]);
		const html = renderBranches(snapshot({ branchSummaries: summaries }));
		assert.ok(html.includes('These files are changed on more than one branch.'));
		assert.ok(html.includes('<li><code class="path">src/app.ts</code> on <strong>feature/a</strong> and <strong>feature/b</strong></li>'));
		assert.ok(!html.includes('<code class="path">README.md</code> on'));
	});

	test('Branches tab has an empty state and handles a branch with no commits', () => {
		assert.ok(renderBranches(snapshot({ branchSummaries: [] })).includes('No branches with commits yet'));
		const html = renderBranches(snapshot({ branchSummaries: [branch({ name: 'main', isDefault: true, isCurrent: true, lastCommit: undefined })] }));
		assert.ok(html.includes('No commits on this branch yet.'));
		const detached = renderBranches(snapshot({ isDetached: true, currentBranch: 'abc1234 (detached)' }));
		assert.ok(detached.includes('You are not on a branch right now.'));
	});

	// ---- activity ------------------------------------------------------------------

	test('day labels and clock times are locale-independent', () => {
		assert.strictEqual(formatDayLabel(new Date(2026, 9, 17, 1), NOW), 'Today');
		assert.strictEqual(formatDayLabel(new Date(2026, 9, 16, 23), NOW), 'Yesterday');
		assert.strictEqual(formatDayLabel(new Date(2026, 9, 13), NOW), 'Tue, Oct 13');
		assert.strictEqual(formatDayLabel(new Date(2025, 11, 31), NOW), 'Wed, Dec 31, 2025');
		assert.strictEqual(formatClock(new Date(2026, 0, 1, 0, 5)), '12:05 AM');
		assert.strictEqual(formatClock(new Date(2026, 0, 1, 12, 0)), '12:00 PM');
		assert.strictEqual(formatClock(new Date(2026, 0, 1, 15, 42)), '3:42 PM');
	});

	test('commits group by day, out-of-order dates merge into their day, undated commits go last', () => {
		const commits = [
			commit({ hash: '1'.repeat(40), date: localIso(2026, 9, 17, 14) }),
			commit({ hash: '2'.repeat(40), date: localIso(2026, 9, 16, 9) }),
			commit({ hash: '3'.repeat(40), date: localIso(2026, 9, 17, 8) }),
			commit({ hash: '4'.repeat(40), date: undefined, time: '3 weeks ago' }),
			commit({ hash: '5'.repeat(40), date: localIso(2026, 9, 2) })
		];
		const days = groupCommitsByDay(commits, NOW);
		assert.deepStrictEqual(days.map(d => [d.label, d.commits.length]), [['Today', 2], ['Yesterday', 1], ['Fri, Oct 2', 1], ['Earlier', 1]]);
	});

	test('Activity shows messages, authors and times, with the hash only in the tooltip', () => {
		const commits = [
			commit({ message: 'Fix navbar', author: 'Ana', date: localIso(2026, 9, 17, 14, 5), time: '55 minutes ago' }),
			commit({ hash: 'ffffffff' + '0'.repeat(32), message: 'Add footer', author: 'Bo', date: localIso(2026, 9, 16, 9, 0), time: '1 day ago' })
		];
		const html = renderActivity(snapshot({ commits, filesTouched: ['src/nav.ts', 'src/footer.ts'] }), NOW);
		assert.ok(html.includes('<h2>Recent activity</h2>'));
		assert.ok(html.includes('Showing your 2 most recent commits.'));
		assert.ok(html.includes('<h3 class="day">Today</h3>'));
		assert.ok(html.includes('<h3 class="day">Yesterday</h3>'));
		assert.ok(html.includes('<div class="commit-message">Fix navbar</div><div class="muted">Ana · 2:05 PM · 55 minutes ago</div>'));
		assert.ok(html.includes('title="Commit a1b2c3d · '));
		assert.ok(html.includes('title="Commit fffffff · '));
		assert.ok(!/>[^<]*a1b2c3d/.test(html), 'the hash is not in visible text');
		assert.ok(html.includes('<h2>Recently touched files</h2>'));
		assert.ok(html.includes('<li><code class="path">src/footer.ts</code></li>'));
	});

	test('Activity truncates touched files and has an empty state', () => {
		const files = Array.from({ length: 15 }, (_, i) => `file${i}.ts`);
		assert.ok(renderActivity(snapshot({ filesTouched: files }), NOW).includes('…and 3 more'));
		const empty = renderActivity(snapshot({ commits: [], filesTouched: [] }), NOW);
		assert.ok(empty.includes('No commits yet'));
		assert.ok(!empty.includes('Recently touched files'));
	});

	// ---- escaping ------------------------------------------------------------------

	test('repository text is escaped on all three tabs, including tooltips', () => {
		const evil = '<img src=x>"&\'';
		const hostileCommit = commit({ hash: '<script>x</script>0000000000000000000000', message: `<script>alert(1)</script>`, author: evil });
		const s = snapshot({
			currentBranch: evil,
			defaultBranch: '<b>main</b>',
			changedFiles: [{ path: `src/${evil}.ts`, status: ' M' }],
			branchSummaries: [
				branch({ name: '<b>main</b>', isDefault: true, isCurrent: true, lastCommit: hostileCommit }),
				branch({ name: `feat/${evil}`, filesChanged: [`${evil}.ts`] }),
				branch({ name: 'feat/two', filesChanged: [`${evil}.ts`] })
			],
			commits: [hostileCommit],
			filesTouched: [`${evil}.ts`]
		});
		for (const html of [renderOverview(s), renderBranches(s), renderActivity(s, NOW)]) {
			for (const raw of ['<img src=x>', '<script>', '<b>main</b>']) {
				assert.ok(!html.includes(raw), `${raw} never appears raw`);
			}
			assert.ok(!/\son[a-z]+=/i.test(html), 'no inline handlers');
		}
		assert.ok(renderActivity(s, NOW).includes('title="Commit &lt;script'));
		assert.ok(renderBranches(s).includes('&lt;img src=x&gt;&quot;&amp;&#39;.ts</code> on'));
	});

	// ---- real repository -----------------------------------------------------------

	test('a real repository renders stage tags, a branch comparison and today\'s commits', () => {
		const repo = makeTempRepo();
		git(repo, 'switch', '-c', 'feature/x');
		commitFile(repo, 'src/x.ts', 'x\n', 'Add x');
		git(repo, 'switch', 'main');
		writeFile(repo, 'staged.txt', 'new\n');
		git(repo, 'add', 'staged.txt');
		writeFile(repo, 'README.md', 'changed\n');
		writeFile(repo, 'untracked.txt', 'u\n');

		const s = getRepoSnapshot(repo);
		const overview = renderOverview(s);
		assert.ok(overview.includes('<code class="path">staged.txt</code><span class="tags"><span class="badge">Added</span><span class="stage stage-staged">Staged</span>'));
		assert.ok(overview.includes('<code class="path">README.md</code><span class="tags"><span class="badge">Modified</span><span class="stage stage-unstaged">Not staged</span>'));
		assert.ok(overview.includes('<span class="stage stage-untracked">Untracked</span>'));
		assert.ok(overview.includes('Only on this computer.'));

		const branches = renderBranches(s);
		assert.ok(branches.includes('1 commit only on this branch (not on main yet).'));
		assert.ok(branches.includes('<li><code class="path">src/x.ts</code></li>'));

		const activity = renderActivity(s);
		assert.ok(activity.includes('<h3 class="day">Today</h3>'));
		assert.ok(activity.includes('Initial commit'));
	});
});
