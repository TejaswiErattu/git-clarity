import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	getAheadBehind,
	getBranches,
	getChangedFiles,
	getDefaultBranch,
	getFilesTouched,
	getHead,
	getRecentCommits,
	getRepoSnapshot,
	isGitRepo
} from '../git/gitCommands';
import { cleanupTempDirs, commitFile, git, isolateGitEnv, makeDivergedClones, makeTempRepo, writeFile } from './helpers/tempRepo';

const extraDirs: string[] = [];

function makeBareFolder(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-clarity-folder-'));
	extraDirs.push(dir);
	return dir;
}

suite('gitCommands: data layer', () => {
	suiteSetup(isolateGitEnv);
	suiteTeardown(() => {
		cleanupTempDirs();
		for (const dir of extraDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('a folder that is not a repo gives an empty snapshot, not an error', () => {
		const folder = makeBareFolder();
		assert.strictEqual(isGitRepo(folder), false);
		const snapshot = getRepoSnapshot(folder);
		assert.strictEqual(snapshot.isRepo, false);
		assert.strictEqual(snapshot.repoName, path.basename(folder));
		assert.deepStrictEqual(snapshot.commits, []);
		assert.deepStrictEqual(snapshot.changedFiles, []);
	});

	test('a repo with no commits yet still produces a usable snapshot', () => {
		const folder = makeBareFolder();
		git(folder, 'init', '-b', 'main');
		writeFile(folder, 'first.txt', 'hi\n');
		const snapshot = getRepoSnapshot(folder);
		assert.strictEqual(snapshot.isRepo, true);
		assert.strictEqual(snapshot.hasCommits, false);
		assert.strictEqual(snapshot.currentBranch, 'main');
		assert.strictEqual(snapshot.isDetached, false);
		assert.deepStrictEqual(snapshot.branches, [{ name: 'main', isCurrent: true }]);
		assert.strictEqual(snapshot.defaultBranch, 'main');
		assert.deepStrictEqual(snapshot.commits, []);
		assert.deepStrictEqual(snapshot.filesTouched, []);
		assert.deepStrictEqual(snapshot.changedFiles, [{ path: 'first.txt', status: '??' }]);
	});

	test('branches are listed with the current one flagged and main as the default', () => {
		const repo = makeTempRepo();
		git(repo, 'branch', 'feature/login');
		git(repo, 'switch', '-c', 'feature/navbar');
		const branches = getBranches(repo);
		assert.deepStrictEqual(
			branches.map(b => `${b.name}${b.isCurrent ? '*' : ''}`).sort(),
			['feature/login', 'feature/navbar*', 'main']
		);
		assert.strictEqual(getDefaultBranch(repo, branches), 'main');
		assert.strictEqual(getHead(repo).name, 'feature/navbar');
	});

	test('an unstaged edit on the first status line keeps its full path and status', () => {
		const repo = makeTempRepo();
		writeFile(repo, 'README.md', 'changed\n');
		assert.deepStrictEqual(getChangedFiles(repo), [{ path: 'README.md', status: ' M' }]);
	});

	test('staged, unstaged, untracked-in-folder and renamed files are reported with the right status', () => {
		const repo = makeTempRepo();
		commitFile(repo, 'src/old.js', 'x\n', 'add old');
		git(repo, 'mv', 'src/old.js', 'src/new.js');
		writeFile(repo, 'README.md', 'changed\n');
		writeFile(repo, 'docs/notes/todo.txt', 'todo\n');
		writeFile(repo, 'staged.txt', 'staged\n');
		git(repo, 'add', 'staged.txt');

		const byPath = Object.fromEntries(getChangedFiles(repo).map(f => [f.path, f.status]));
		assert.strictEqual(byPath['README.md'], ' M');
		assert.strictEqual(byPath['staged.txt'], 'A ');
		assert.strictEqual(byPath['docs/notes/todo.txt'], '??', 'untracked files inside new folders are listed individually');
		assert.strictEqual(byPath['src/new.js'], 'R ', 'a rename reports the new path');
		assert.strictEqual(byPath['src/old.js'], undefined, 'the old path of a rename is not a separate entry');
	});

	test('file names with spaces, quotes and non-ASCII characters are reported exactly', () => {
		const repo = makeTempRepo();
		const names = ['my file.txt', 'quote"d.txt', 'café.txt'];
		for (const name of names) {
			writeFile(repo, name, 'x\n');
		}
		const paths = getChangedFiles(repo).map(f => f.path).sort();
		assert.deepStrictEqual(paths, [...names].sort());
	});

	test('recent commits carry hash, message, author, relative time and ISO date, newest first', () => {
		const repo = makeTempRepo();
		commitFile(repo, 'a.txt', 'a\n', 'Second commit: with "quotes" and ; semicolons');
		const commits = getRecentCommits(repo, 10);
		assert.strictEqual(commits.length, 2);
		assert.strictEqual(commits[0].message, 'Second commit: with "quotes" and ; semicolons');
		assert.strictEqual(commits[1].message, 'Initial commit');
		assert.match(commits[0].hash, /^[0-9a-f]{40}$/);
		assert.strictEqual(commits[0].author, 'Test User');
		assert.ok(commits[0].time.length > 0);
		assert.match(commits[0].date ?? '', /^\d{4}-\d{2}-\d{2}T/);
		assert.strictEqual(getRecentCommits(repo, 1).length, 1, 'limit is respected');
	});

	test('files touched lists paths from recent commits, newest first, without duplicates', () => {
		const repo = makeTempRepo();
		commitFile(repo, 'src/a.js', '1\n', 'add a');
		commitFile(repo, 'src/b.js', '1\n', 'add b');
		commitFile(repo, 'src/a.js', '2\n', 'edit a');
		assert.deepStrictEqual(getFilesTouched(repo), ['src/a.js', 'src/b.js', 'README.md']);
	});

	test('ahead/behind: no upstream is reported as such; a diverged clone is 1 ahead and 1 behind', () => {
		const repo = makeTempRepo();
		assert.deepStrictEqual(getAheadBehind(repo), { ahead: 0, behind: 0, hasUpstream: false });

		const { b } = makeDivergedClones();
		assert.deepStrictEqual(getAheadBehind(b), { ahead: 1, behind: 1, hasUpstream: true });
	});

	test('branch summaries report commits ahead and behind main and the files each branch changed', () => {
		const repo = makeTempRepo();
		git(repo, 'switch', '-c', 'feature/login');
		commitFile(repo, 'src/login.js', 'login\n', 'add login');
		commitFile(repo, 'src/utils.js', 'util\n', 'add utils');
		git(repo, 'switch', 'main');
		commitFile(repo, 'src/index.js', 'index\n', 'add index');

		const snapshot = getRepoSnapshot(repo);
		const main = snapshot.branchSummaries.find(b => b.name === 'main')!;
		const login = snapshot.branchSummaries.find(b => b.name === 'feature/login')!;
		assert.strictEqual(main.isDefault, true);
		assert.strictEqual(main.isCurrent, true);
		assert.strictEqual(login.commitsAhead, 2);
		assert.strictEqual(login.commitsBehind, 1);
		assert.deepStrictEqual(login.filesChanged.sort(), ['src/login.js', 'src/utils.js']);
		assert.strictEqual(login.lastCommit?.message, 'add utils');
		assert.strictEqual(main.lastCommit?.message, 'add index');
	});

	test('a branch name with shell metacharacters is data: nothing runs and it is summarized normally', () => {
		const repo = makeTempRepo();
		const hostile = 'pwn;touch;owned|id&`id`$HOME';
		git(repo, 'switch', '-c', hostile);
		commitFile(repo, 'evil.txt', 'x\n', 'commit on hostile branch');
		git(repo, 'switch', 'main');

		const snapshot = getRepoSnapshot(repo);
		assert.ok(!fs.existsSync(path.join(repo, 'owned')), 'no command ran');
		const summary = snapshot.branchSummaries.find(b => b.name === hostile);
		assert.ok(summary, 'the hostile branch is listed');
		assert.strictEqual(summary.commitsAhead, 1);
		assert.deepStrictEqual(summary.filesChanged, ['evil.txt']);
		assert.strictEqual(summary.lastCommit?.message, 'commit on hostile branch');
	});

	test('detached HEAD is reported as detached with a short sha', () => {
		const repo = makeTempRepo();
		commitFile(repo, 'a.txt', 'a\n', 'second');
		git(repo, 'checkout', '--detach', 'HEAD~1');
		const snapshot = getRepoSnapshot(repo);
		assert.strictEqual(snapshot.isDetached, true);
		assert.match(snapshot.currentBranch, /^[0-9a-f]{7,} \(detached\)$/);
		assert.strictEqual(snapshot.branches.some(b => b.isCurrent), false);
		assert.strictEqual(snapshot.hasCommits, true);
	});

	test('the snapshot is read-only: status, HEAD and refs are identical before and after', () => {
		const repo = makeTempRepo();
		writeFile(repo, 'README.md', 'changed\n');
		writeFile(repo, 'new.txt', 'new\n');
		const before = [git(repo, 'status', '--porcelain'), git(repo, 'rev-parse', 'HEAD'), git(repo, 'for-each-ref')];
		getRepoSnapshot(repo);
		const after = [git(repo, 'status', '--porcelain'), git(repo, 'rev-parse', 'HEAD'), git(repo, 'for-each-ref')];
		assert.deepStrictEqual(after, before);
	});
});
