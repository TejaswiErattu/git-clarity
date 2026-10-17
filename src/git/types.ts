/**
 * Shared Git data types. The dashboard's data layer (getRepoSnapshot and friends)
 * fills these in; the Assistant, Secret Guard and UI read them.
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
	/** ISO date, when available. */
	date?: string;
}

export interface ChangedFile {
	/** Path relative to the repo root, forward slashes. */
	path: string;
	/** Two-column `git status --porcelain` code, e.g. " M", "A ", "??". */
	status: string;
}

export interface AheadBehind {
	ahead: number;
	behind: number;
	hasUpstream: boolean;
}

/** Everything the dashboard needs about the open repo, read once per refresh. */
export interface RepoSnapshot {
	isRepo: boolean;
	repoName: string;
	currentBranch: string;
	branches: BranchInfo[];
	commits: CommitInfo[];
	changedFileCount: number;
	changedFiles: ChangedFile[];
	aheadBehind: AheadBehind;
}
