import { ChangedFile, RepoSnapshot } from '../../git/types';
import { card, emptyState, escapeHtml } from './html';

/** How many changed files the Overview lists before saying "and N more". */
export const MAX_OVERVIEW_FILES = 8;

/**
 * Turn a two-column `git status --porcelain` code into words a beginner understands.
 * "Ready to save" means staged; we never say "staged" or "index" on the Overview.
 */
export function describeStatus(status: string): string {
	const [index, work] = [status[0] ?? ' ', status[1] ?? ' '];
	if (status === '??') {
		return 'New file (not tracked yet)';
	}
	if (index === 'U' || work === 'U' || status === 'AA' || status === 'DD') {
		return 'Conflict, needs your attention';
	}
	if (index === 'R') {
		return 'Renamed';
	}
	if (index === 'C') {
		return 'Copied';
	}
	if (index === 'A') {
		return 'New file, ready to save';
	}
	if (index === 'D' || work === 'D') {
		return 'Deleted';
	}
	if (index === 'M' && work === 'M') {
		return 'Edited (part is ready to save)';
	}
	if (index === 'M') {
		return 'Edited, ready to save';
	}
	if (work === 'M') {
		return 'Edited';
	}
	return 'Changed';
}

function stat(label: string, value: string, hint?: string): string {
	const hintHtml = hint ? `<div class="muted">${escapeHtml(hint)}</div>` : '';
	return `<div class="stat"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div>${hintHtml}</div>`;
}

function branchHint(snapshot: RepoSnapshot): string | undefined {
	if (snapshot.isDetached) {
		return 'Not on a branch right now';
	}
	const { ahead, behind, hasUpstream } = snapshot.aheadBehind;
	if (!hasUpstream) {
		return undefined;
	}
	if (ahead === 0 && behind === 0) {
		return 'In sync with the remote';
	}
	const parts = [];
	if (ahead > 0) {
		parts.push(`${ahead} to push`);
	}
	if (behind > 0) {
		parts.push(`${behind} to pull`);
	}
	return parts.join(', ');
}

function renderFileList(files: ChangedFile[], total: number): string {
	if (files.length === 0) {
		return '<p class="muted">Nothing has changed since your last save. Edit a file and it will show up here.</p>';
	}
	const items = files
		.slice(0, MAX_OVERVIEW_FILES)
		.map(f => `<li><code class="path">${escapeHtml(f.path)}</code><span class="badge">${escapeHtml(describeStatus(f.status))}</span></li>`)
		.join('');
	const remaining = total - Math.min(files.length, MAX_OVERVIEW_FILES);
	const more = remaining > 0 ? `<p class="muted">…and ${remaining} more</p>` : '';
	return `<ul class="files">${items}</ul>${more}`;
}

export function renderOverview(snapshot: RepoSnapshot): string {
	const count = snapshot.changedFileCount;
	const stats = [
		stat('Repository', snapshot.repoName),
		stat('Current branch', snapshot.currentBranch || 'none yet', branchHint(snapshot)),
		stat('Changed files', String(count), count === 0 ? 'Everything is saved' : 'Not saved to Git yet')
	].join('');
	const noCommits = snapshot.hasCommits
		? ''
		: emptyState('🌱', 'No commits yet', 'This repository is brand new. Your first save will create its first commit.');
	return `<div class="stats">${stats}</div>${noCommits}${card('Changed files', renderFileList(snapshot.changedFiles, count))}`;
}
