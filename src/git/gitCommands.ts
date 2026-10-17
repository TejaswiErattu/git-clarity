/**
 * Git data layer: read-only queries that build a RepoSnapshot for the dashboard.
 *
 * Rules:
 *   - Every git call goes through runGit with an argv array. No shell, ever. Branch
 *     names and paths come from the repo and may contain `;`, `$`, backticks and
 *     spaces; with argv they are plain data.
 *   - Revisions from the repo are passed after `--end-of-options` and before `--`,
 *     so a strange name can never be read as a flag or a path.
 *   - Nothing here writes. Every query degrades to an empty value on failure so the
 *     dashboard renders an empty state instead of a stack trace (no repo, no commits
 *     yet, detached HEAD, no upstream, unrelated histories).
 */

import { execFileSync } from 'child_process';
import * as path from 'path';
import { AheadBehind, BranchInfo, BranchSummary, ChangedFile, CommitInfo, RepoSnapshot } from './types';

const FIELD = '\x1f';
const RECORD = '\x1e';
const MAX_BUFFER = 16 * 1024 * 1024;
const COMMIT_FORMAT = `%H${FIELD}%s${FIELD}%an${FIELD}%ar${FIELD}%aI${RECORD}`;

/** Runs git with an argv array and returns raw stdout (not trimmed: status output is whitespace-sensitive). */
function runGit(cwd: string, args: string[]): string {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		maxBuffer: MAX_BUFFER
	});
}

/** Like runGit, but a failing command yields undefined instead of throwing. */
function tryGit(cwd: string, args: string[]): string | undefined {
	try {
		return runGit(cwd, args);
	} catch {
		return undefined;
	}
}

function toPosix(p: string): string {
	return p.replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// Repo basics
// ---------------------------------------------------------------------------

export function isGitRepo(cwd: string): boolean {
	return tryGit(cwd, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';
}

export function getRepoRoot(cwd: string): string | undefined {
	return tryGit(cwd, ['rev-parse', '--show-toplevel'])?.trim();
}

export function getRepoName(cwd: string): string {
	return path.basename(getRepoRoot(cwd) ?? cwd);
}

/** False on a freshly initialised repo whose branch has no commits yet. */
export function hasCommits(cwd: string): boolean {
	return tryGit(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']) !== undefined;
}

export interface HeadInfo {
	/** Branch name, or "<short sha> (detached)" when not on a branch. */
	name: string;
	isDetached: boolean;
}

export function getHead(cwd: string): HeadInfo {
	const branch = tryGit(cwd, ['symbolic-ref', '--short', '--quiet', 'HEAD'])?.trim();
	if (branch) {
		return { name: branch, isDetached: false };
	}
	const sha = tryGit(cwd, ['rev-parse', '--short', 'HEAD'])?.trim();
	return { name: sha ? `${sha} (detached)` : 'unknown', isDetached: true };
}

export function getCurrentBranch(cwd: string): string {
	return getHead(cwd).name;
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

/** Local branches. On a repo with no commits, the unborn current branch is still listed. */
export function getBranches(cwd: string): BranchInfo[] {
	const out = tryGit(cwd, ['for-each-ref', `--format=%(refname:short)${FIELD}%(HEAD)`, 'refs/heads/']) ?? '';
	const branches: BranchInfo[] = out
		.split('\n')
		.filter(line => line.length > 0)
		.map(line => {
			const [name, head] = line.split(FIELD);
			return { name, isCurrent: head === '*' };
		});

	const head = getHead(cwd);
	if (!head.isDetached && !branches.some(b => b.name === head.name)) {
		branches.unshift({ name: head.name, isCurrent: true });
	}
	return branches;
}

/** "main", then "master", then whatever origin/HEAD points at, then the current branch. */
export function getDefaultBranch(cwd: string, branches: BranchInfo[] = getBranches(cwd)): string {
	for (const candidate of ['main', 'master']) {
		if (branches.some(b => b.name === candidate)) {
			return candidate;
		}
	}
	const originHead = tryGit(cwd, ['symbolic-ref', '--short', '--quiet', 'refs/remotes/origin/HEAD'])?.trim();
	if (originHead) {
		return originHead.replace(/^origin\//, '');
	}
	return branches.find(b => b.isCurrent)?.name ?? 'main';
}

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

function parseCommits(raw: string | undefined): CommitInfo[] {
	if (!raw) {
		return [];
	}
	return raw
		.split(RECORD)
		.map(record => record.replace(/^\n/, ''))
		.filter(record => record.length > 0)
		.map(record => {
			const [hash, message, author, time, date] = record.split(FIELD);
			return { hash, message, author, time, date };
		});
}

/** Newest first. `ref` defaults to HEAD; it is passed as data, never as a flag or path. */
export function getRecentCommits(cwd: string, limit = 15, ref?: string): CommitInfo[] {
	const args = [`--max-count=${limit}`, `--format=${COMMIT_FORMAT}`];
	const revision = ref ? ['--end-of-options', ref, '--'] : ['--'];
	return parseCommits(tryGit(cwd, ['log', ...args, ...revision]));
}

/** Paths changed in the most recent commits, newest first, deduplicated. */
export function getFilesTouched(cwd: string, commitLimit = 15): string[] {
	const out = tryGit(cwd, ['log', `--max-count=${commitLimit}`, '--name-only', '--format=', '--']);
	if (!out) {
		return [];
	}
	const seen = new Set<string>();
	const files: string[] = [];
	for (const line of out.split('\n')) {
		const file = toPosix(line.trim());
		if (file && !seen.has(file)) {
			seen.add(file);
			files.push(file);
		}
	}
	return files;
}

// ---------------------------------------------------------------------------
// Working tree
// ---------------------------------------------------------------------------

/**
 * Parses `git status --porcelain=v1 -z`. NUL separators mean paths with spaces, quotes
 * or non-ASCII characters arrive exactly as they are, and a leading space in the status
 * column (an unstaged edit) is never lost. Renames and copies report the new path.
 */
export function getChangedFiles(cwd: string): ChangedFile[] {
	const out = tryGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
	if (!out) {
		return [];
	}
	const tokens = out.split('\0');
	const files: ChangedFile[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const entry = tokens[i];
		if (entry.length < 4) {
			continue;
		}
		const status = entry.slice(0, 2);
		const filePath = toPosix(entry.slice(3));
		files.push({ path: filePath, status });
		if (status[0] === 'R' || status[0] === 'C') {
			i++; // the next token is the original path
		}
	}
	return files;
}

export function getAheadBehind(cwd: string): AheadBehind {
	const out = tryGit(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}', '--'])?.trim();
	if (!out) {
		return { ahead: 0, behind: 0, hasUpstream: false };
	}
	const [ahead, behind] = out.split(/\s+/).map(n => Number.parseInt(n, 10) || 0);
	return { ahead, behind, hasUpstream: true };
}

// ---------------------------------------------------------------------------
// Branch summaries
// ---------------------------------------------------------------------------

function compareWithDefault(cwd: string, defaultBranch: string, branch: string): { ahead: number; behind: number; files: string[] } {
	const range = `${defaultBranch}...${branch}`;
	const counts = tryGit(cwd, ['rev-list', '--left-right', '--count', '--end-of-options', range, '--'])?.trim();
	const [behind, ahead] = counts ? counts.split(/\s+/).map(n => Number.parseInt(n, 10) || 0) : [0, 0];
	const diff = tryGit(cwd, ['diff', '--name-only', '--end-of-options', range, '--']) ?? '';
	const files = diff
		.split('\n')
		.map(line => toPosix(line.trim()))
		.filter(line => line.length > 0);
	return { ahead, behind, files };
}

export function getBranchSummaries(cwd: string, branches: BranchInfo[], defaultBranch: string): BranchSummary[] {
	return branches.map(branch => {
		const lastCommit = getRecentCommits(cwd, 1, branch.name)[0];
		const isDefault = branch.name === defaultBranch;
		const comparison = isDefault ? { ahead: 0, behind: 0, files: [] } : compareWithDefault(cwd, defaultBranch, branch.name);
		return {
			name: branch.name,
			isCurrent: branch.isCurrent,
			isDefault,
			lastCommit,
			commitsAhead: comparison.ahead,
			commitsBehind: comparison.behind,
			filesChanged: comparison.files
		};
	});
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export function emptySnapshot(cwd: string): RepoSnapshot {
	return {
		isRepo: false,
		repoName: path.basename(cwd),
		currentBranch: '',
		isDetached: false,
		hasCommits: false,
		defaultBranch: 'main',
		branches: [],
		branchSummaries: [],
		commits: [],
		changedFileCount: 0,
		changedFiles: [],
		aheadBehind: { ahead: 0, behind: 0, hasUpstream: false },
		filesTouched: []
	};
}

/** One read of everything the dashboard shows. Safe to call on any folder. */
export function getRepoSnapshot(cwd: string, options: { commitLimit?: number } = {}): RepoSnapshot {
	if (!isGitRepo(cwd)) {
		return emptySnapshot(cwd);
	}
	const commitLimit = options.commitLimit ?? 15;
	const head = getHead(cwd);
	const branches = getBranches(cwd);
	const defaultBranch = getDefaultBranch(cwd, branches);
	const changedFiles = getChangedFiles(cwd);
	return {
		isRepo: true,
		repoName: getRepoName(cwd),
		currentBranch: head.name,
		isDetached: head.isDetached,
		hasCommits: hasCommits(cwd),
		defaultBranch,
		branches,
		branchSummaries: getBranchSummaries(cwd, branches, defaultBranch),
		commits: getRecentCommits(cwd, commitLimit),
		changedFileCount: changedFiles.length,
		changedFiles,
		aheadBehind: getAheadBehind(cwd),
		filesTouched: getFilesTouched(cwd, commitLimit)
	};
}
