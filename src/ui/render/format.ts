/**
 * Pure formatting helpers for the read-only tabs (Overview, Branches, Activity).
 * Everything here works on RepoSnapshot data that already exists; nothing runs Git.
 * Dates use built-in tables, not the machine locale, so output is the same everywhere.
 */

import { BranchSummary, CommitInfo, RepoSnapshot } from '../../git/types';

export function plural(count: number, one: string, many = `${one}s`): string {
	return `${count} ${count === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Sync status
// ---------------------------------------------------------------------------

export type Tone = 'ok' | 'info' | 'warn';

export interface SyncStatus {
	tone: Tone;
	headline: string;
	detail: string;
}

const SHARED_COPY = 'the shared copy (for example on GitHub)';

export function syncStatus(snapshot: Pick<RepoSnapshot, 'isDetached' | 'aheadBehind'>): SyncStatus {
	if (snapshot.isDetached) {
		return {
			tone: 'warn',
			headline: 'Not on a branch right now.',
			detail: 'You are looking at an older saved version. Switch to a branch before making changes you want to keep.'
		};
	}
	const { ahead, behind, hasUpstream } = snapshot.aheadBehind;
	if (!hasUpstream) {
		return {
			tone: 'info',
			headline: 'Only on this computer.',
			detail: `This branch is not connected to ${SHARED_COPY} yet, so there is nothing to upload to or download from.`
		};
	}
	if (ahead === 0 && behind === 0) {
		return { tone: 'ok', headline: 'In sync with the remote.', detail: `Your branch matches ${SHARED_COPY}.` };
	}
	if (behind === 0) {
		return {
			tone: 'info',
			headline: `${plural(ahead, 'commit')} to upload.`,
			detail: `You saved ${plural(ahead, 'commit')} that ${ahead === 1 ? 'is' : 'are'} not on ${SHARED_COPY} yet. Uploading (push) shares ${ahead === 1 ? 'it' : 'them'}.`
		};
	}
	if (ahead === 0) {
		return {
			tone: 'info',
			headline: `${plural(behind, 'commit')} to download.`,
			detail: `The shared copy has ${plural(behind, 'new commit')} you don't have yet. Downloading (pull) brings ${behind === 1 ? 'it' : 'them'} in.`
		};
	}
	return {
		tone: 'warn',
		headline: `${plural(ahead, 'commit')} to upload and ${behind} to download.`,
		detail: 'Your branch and the shared copy each have new commits. Download first, and ask a teammate if Git can\'t combine them.'
	};
}

// ---------------------------------------------------------------------------
// Changed files
// ---------------------------------------------------------------------------

export type ChangeKind = 'Modified' | 'Added' | 'Deleted' | 'Renamed' | 'Copied' | 'Untracked' | 'Conflict';
export type ChangeStage = 'staged' | 'unstaged' | 'partly' | 'untracked' | 'conflict';

export interface ChangeDescription {
	kind: ChangeKind;
	stage: ChangeStage;
}

export const STAGE_LABEL: Record<ChangeStage, string> = {
	staged: 'Staged',
	unstaged: 'Not staged',
	partly: 'Partly staged',
	untracked: 'Untracked',
	conflict: 'Conflict'
};

export const STAGE_GLOSS: Array<[ChangeStage, string]> = [
	['staged', 'ready to go into your next commit'],
	['unstaged', 'changed, but not marked for the next commit yet'],
	['partly', 'some of the edits are ready for the next commit, some are not'],
	['untracked', 'a new file Git is not keeping track of yet']
];

function kindFor(code: string): ChangeKind {
	switch (code) {
		case 'A':
			return 'Added';
		case 'D':
			return 'Deleted';
		case 'R':
			return 'Renamed';
		case 'C':
			return 'Copied';
		default:
			return 'Modified';
	}
}

/** Two-column porcelain code (staged column, then working-file column) to a kind and a stage. */
export function describeChange(status: string): ChangeDescription {
	const index = status[0] ?? ' ';
	const work = status[1] ?? ' ';
	if (status === '??') {
		return { kind: 'Untracked', stage: 'untracked' };
	}
	if (index === 'U' || work === 'U' || status === 'AA' || status === 'DD') {
		return { kind: 'Conflict', stage: 'conflict' };
	}
	if (index !== ' ' && work !== ' ') {
		return { kind: kindFor(index), stage: 'partly' };
	}
	if (index !== ' ') {
		return { kind: kindFor(index), stage: 'staged' };
	}
	return { kind: kindFor(work), stage: 'unstaged' };
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

export interface FileOverlap {
	file: string;
	branches: string[];
}

/** Files changed (compared with the default branch) on two or more non-default branches. */
export function overlappingFiles(summaries: BranchSummary[]): FileOverlap[] {
	const byFile = new Map<string, string[]>();
	for (const branch of summaries) {
		if (branch.isDefault) {
			continue;
		}
		for (const file of new Set(branch.filesChanged)) {
			byFile.set(file, [...(byFile.get(file) ?? []), branch.name]);
		}
	}
	return [...byFile.entries()]
		.filter(([, branches]) => branches.length > 1)
		.map(([file, branches]) => ({ file, branches }))
		.sort((a, b) => a.file.localeCompare(b.file));
}

/** Current branch first, then the default branch, then the rest by name. */
export function orderBranches(summaries: BranchSummary[]): BranchSummary[] {
	const rank = (b: BranchSummary) => (b.isCurrent ? 0 : b.isDefault ? 1 : 2);
	return [...summaries].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayKey(d: Date): string {
	return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today", "Yesterday", "Mon, Oct 13", or "Mon, Oct 13, 2025" when the year differs. Local time. */
export function formatDayLabel(day: Date, now: Date): string {
	const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
	if (dayKey(day) === dayKey(now)) {
		return 'Today';
	}
	if (dayKey(day) === dayKey(yesterday)) {
		return 'Yesterday';
	}
	const base = `${WEEKDAYS[day.getDay()]}, ${MONTHS[day.getMonth()]} ${day.getDate()}`;
	return day.getFullYear() === now.getFullYear() ? base : `${base}, ${day.getFullYear()}`;
}

/** "3:42 PM" in local time. */
export function formatClock(d: Date): string {
	const hours = d.getHours();
	const minutes = String(d.getMinutes()).padStart(2, '0');
	return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

export interface DatedCommit {
	commit: CommitInfo;
	/** Undefined when the commit has no parseable date. */
	when?: Date;
}

export interface CommitDay {
	label: string;
	commits: DatedCommit[];
}

function parseDate(iso: string | undefined): Date | undefined {
	if (!iso) {
		return undefined;
	}
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Groups commits by local calendar day, in the order each day first appears (newest first for git log).
 * Commits whose dates are out of order (e.g. after a rebase) still land in their own day.
 * Commits without a date go last, under "Earlier".
 */
export function groupCommitsByDay(commits: CommitInfo[], now: Date): CommitDay[] {
	const byDay = new Map<string, CommitDay>();
	const undated: DatedCommit[] = [];
	for (const commit of commits) {
		const when = parseDate(commit.date);
		if (!when) {
			undated.push({ commit });
			continue;
		}
		const key = dayKey(when);
		const day = byDay.get(key) ?? { label: formatDayLabel(when, now), commits: [] };
		day.commits.push({ commit, when });
		byDay.set(key, day);
	}
	const days = [...byDay.values()];
	if (undated.length > 0) {
		days.push({ label: 'Earlier', commits: undated });
	}
	return days;
}
