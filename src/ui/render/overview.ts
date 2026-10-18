import { ChangedFile, RepoSnapshot } from '../../git/types';
import { card, emptyState, escapeHtml } from './html';
import { ChangeStage, describeChange, plural, STAGE_GLOSS, STAGE_LABEL, syncStatus } from './format';

/** How many changed files the Overview lists before saying "and N more". */
export const MAX_OVERVIEW_FILES = 8;

/**
 * Turn a two-column `git status --porcelain` code into one short phrase ("Edited, ready to save").
 * Kept for callers that want a single phrase. The Overview itself (T5) shows a kind badge plus a
 * staged / not staged tag from describeChange in ./format, with a legend that explains the terms.
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

function renderSync(snapshot: RepoSnapshot): string {
	const status = syncStatus(snapshot);
	return `<div class="sync tone-${status.tone}"><strong>${escapeHtml(status.headline)}</strong> <span>${escapeHtml(status.detail)}</span></div>`;
}

function stageTag(stage: ChangeStage): string {
	return `<span class="stage stage-${stage}">${STAGE_LABEL[stage]}</span>`;
}

/** "2 staged · 3 not staged · 1 untracked", counting every changed file, not just the listed ones. */
export function stageSummary(files: ChangedFile[]): string {
	const counts = new Map<ChangeStage, number>();
	for (const f of files) {
		const { stage } = describeChange(f.status);
		counts.set(stage, (counts.get(stage) ?? 0) + 1);
	}
	const order: ChangeStage[] = ['conflict', 'staged', 'partly', 'unstaged', 'untracked'];
	return order
		.filter(stage => counts.has(stage))
		.map(stage => `${counts.get(stage)} ${STAGE_LABEL[stage].toLowerCase()}`)
		.join(' · ');
}

function renderLegend(files: ChangedFile[]): string {
	const present = new Set(files.map(f => describeChange(f.status).stage));
	const items = STAGE_GLOSS.filter(([stage]) => present.has(stage)).map(([stage, gloss]) => `<li>${stageTag(stage)} ${gloss}</li>`);
	if (present.has('conflict')) {
		items.push(`<li>${stageTag('conflict')} Git could not combine two sets of edits here; open the file and choose what to keep</li>`);
	}
	return `<ul class="legend">${items.join('')}</ul>`;
}

function renderFileList(files: ChangedFile[], total: number): string {
	if (files.length === 0) {
		return '<p class="muted">Nothing has changed since your last save. Edit a file and it will show up here.</p>';
	}
	const items = files
		.slice(0, MAX_OVERVIEW_FILES)
		.map(f => {
			const { kind, stage } = describeChange(f.status);
			return `<li><code class="path">${escapeHtml(f.path)}</code><span class="tags"><span class="badge">${kind}</span>${stageTag(stage)}</span></li>`;
		})
		.join('');
	const remaining = total - Math.min(files.length, MAX_OVERVIEW_FILES);
	const more = remaining > 0 ? `<p class="muted">…and ${remaining} more</p>` : '';
	return `<p>${escapeHtml(stageSummary(files))}</p><ul class="files">${items}</ul>${more}${renderLegend(files)}`;
}

export function renderOverview(snapshot: RepoSnapshot): string {
	const count = snapshot.changedFileCount;
	const stats = [
		stat('Repository', snapshot.repoName),
		stat('Current branch', snapshot.currentBranch || 'none yet'),
		stat('Changed files', String(count), count === 0 ? 'Everything is saved' : `${plural(count, 'file')} not saved to Git yet`)
	].join('');
	const noCommits = snapshot.hasCommits
		? ''
		: emptyState('🌱', 'No commits yet', 'This repository is brand new. Your first save will create its first commit.');
	return `${renderSync(snapshot)}<div class="stats">${stats}</div>${noCommits}${card('Changed files', renderFileList(snapshot.changedFiles, count))}`;
}
