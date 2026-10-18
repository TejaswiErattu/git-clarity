/**
 * Activity tab: recent commits grouped by day, plus the files they touched.
 * Uses RepoSnapshot.commits (newest first, a limited number) and filesTouched.
 * Commit hashes stay in tooltips; beginners read messages, authors and times.
 */

import { RepoSnapshot } from '../../git/types';
import { DatedCommit, formatClock, groupCommitsByDay, plural } from './format';
import { card, emptyState, escapeHtml } from './html';

const MAX_TOUCHED_FILES = 12;

function commitRow({ commit, when }: DatedCommit): string {
	const tooltip = escapeHtml(`Commit ${commit.hash.slice(0, 7)}${commit.date ? ` · ${commit.date}` : ''}`);
	const clock = when ? `${formatClock(when)} · ` : '';
	return (
		`<li class="commit" title="${tooltip}">` +
		`<div class="commit-message">${escapeHtml(commit.message)}</div>` +
		`<div class="muted">${escapeHtml(commit.author)} · ${clock}${escapeHtml(commit.time)}</div>` +
		'</li>'
	);
}

function renderTouched(files: string[]): string {
	if (files.length === 0) {
		return '';
	}
	const items = files.slice(0, MAX_TOUCHED_FILES).map(f => `<li><code class="path">${escapeHtml(f)}</code></li>`).join('');
	const remaining = files.length - MAX_TOUCHED_FILES;
	const more = remaining > 0 ? `<p class="muted">…and ${remaining} more</p>` : '';
	return card(
		'Recently touched files',
		`<p class="muted">Files changed by the commits above, most recent first.</p><ul class="files">${items}</ul>${more}`
	);
}

export function renderActivity(snapshot: RepoSnapshot, now: Date = new Date()): string {
	if (snapshot.commits.length === 0) {
		return card('Recent activity', emptyState('🕒', 'No commits yet', 'Your first save will show up here.'));
	}
	const days = groupCommitsByDay(snapshot.commits, now)
		.map(day => `<h3 class="day">${escapeHtml(day.label)}</h3><ul class="commits">${day.commits.map(commitRow).join('')}</ul>`)
		.join('');
	const intro = `<p class="muted">Showing your ${plural(snapshot.commits.length, 'most recent commit', 'most recent commits')}. A commit is a saved checkpoint with a short note.</p>`;
	return card('Recent activity', intro + days) + renderTouched(snapshot.filesTouched);
}
