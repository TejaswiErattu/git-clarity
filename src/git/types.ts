/**
 * Shared Git data types. The data layer (src/git/gitCommands.ts, getRepoSnapshot and
 * friends) fills these in; the Assistant, Secret Guard and UI read them.
 *
 * Keep this file dependency-free so the safety layer and its tests can run
 * outside the VS Code host.
 */

export interface BranchInfo {
	name: string;
	isCurrent: boolean;
}

export interface CommitInfo {
	hash: string;
	message: string;
	author: string;
	/** Relative time, e.g. "2 hours ago". */
	time: string;
	/** ISO 8601 author date, when available. */
	date?: string;
}

export interface ChangedFile {
	/** Path relative to the repo root, forward slashes. For a rename, the new path. */
	path: string;
	/** Two-column `git status --porcelain` code, e.g. " M", "A ", "??". */
	status: string;
}

export interface AheadBehind {
	ahead: number;
	behind: number;
	hasUpstream: boolean;
}

/** One branch compared with the default branch (main), for the Branches tab. */
export interface BranchSummary {
	name: string;
	isCurrent: boolean;
	isDefault: boolean;
	lastCommit?: CommitInfo;
	/** Commits on this branch that the default branch does not have. */
	commitsAhead: number;
	/** Commits on the default branch that this branch does not have. */
	commitsBehind: number;
	/** Files this branch changed since it diverged from the default branch. */
	filesChanged: string[];
}

/** Everything the dashboard needs about the open repo, read once per refresh. */
export interface RepoSnapshot {
	isRepo: boolean;
	repoName: string;
	currentBranch: string;
	/** True when HEAD points at a commit rather than a branch. */
	isDetached: boolean;
	/** False on a brand-new repo with no commits yet. */
	hasCommits: boolean;
	/** "main", "master", or whatever origin/HEAD points at. */
	defaultBranch: string;
	branches: BranchInfo[];
	branchSummaries: BranchSummary[];
	commits: CommitInfo[];
	changedFileCount: number;
	changedFiles: ChangedFile[];
	aheadBehind: AheadBehind;
	/** Paths from recent commits, newest first, no duplicates. */
	filesTouched: string[];
}
