/**
 * Branches tab: every local branch compared with the default branch, in plain English.
 * Uses only RepoSnapshot.branchSummaries. The snapshot carries commit counts, not the
 * commits themselves, so the tab says so instead of inventing a list.
 */

import { BranchSummary, RepoSnapshot } from '../../git/types';
import { FileOverlap, orderBranches, overlappingFiles, plural } from './format';
import { card, emptyState, escapeHtml } from './html';

const MAX_BRANCH_FILES = 8;

function tags(b: BranchSummary): string {
	const out: string[] = [];
	if (b.isCurrent) {
		out.push('<span class="tag tag-current">You are here</span>');
	}
	if (b.isDefault) {
		out.push('<span class="tag tag-default">Main branch</span>');
	}
	return out.join('');
}

/** Plain-English comparison of a branch with the default branch. */
export function compareSentence(b: BranchSummary, defaultBranch: string): string {
	if (b.isDefault) {
		return 'This is the main line of work. Other branches are compared with it.';
	}
	const main = escapeHtml(defaultBranch);
	const parts: string[] = [];
	if (b.commitsAhead > 0) {
		parts.push(`${plural(b.commitsAhead, 'commit')} only on this branch (not on ${main} yet).`);
	}
	if (b.commitsBehind > 0) {
		parts.push(`${plural(b.commitsBehind, 'commit')} on ${main} that this branch doesn't have yet.`);
	}
	return parts.length > 0 ? parts.join(' ') : `Has the same commits as ${main}.`;
}

function lastCommit(b: BranchSummary): string {
	const c = b.lastCommit;
	if (!c) {
		return '<p class="muted">No commits on this branch yet.</p>';
	}
	const tooltip = escapeHtml(`Commit ${c.hash.slice(0, 7)}`);
	return `<p class="last-commit" title="${tooltip}">Last commit: “${escapeHtml(c.message)}” by ${escapeHtml(c.author)}, ${escapeHtml(c.time)}</p>`;
}

function files(b: BranchSummary, defaultBranch: string): string {
	if (b.isDefault) {
		return '';
	}
	const main = escapeHtml(defaultBranch);
	if (b.filesChanged.length === 0) {
		return `<p class="muted">No file differences from ${main}.</p>`;
	}
	const items = b.filesChanged.slice(0, MAX_BRANCH_FILES).map(f => `<li><code class="path">${escapeHtml(f)}</code></li>`).join('');
	const remaining = b.filesChanged.length - MAX_BRANCH_FILES;
	const more = remaining > 0 ? `<p class="muted">…and ${remaining} more</p>` : '';
	return `<p class="muted">Files this branch changed compared with ${main}:</p><ul class="files">${items}</ul>${more}`;
}

function renderBranchCard(b: BranchSummary, defaultBranch: string): string {
	const cls = b.isCurrent ? 'branch current' : 'branch';
	return (
		`<article class="${cls}">` +
		`<div class="branch-head"><h3>${escapeHtml(b.name)}</h3>${tags(b)}</div>` +
		`<p>${compareSentence(b, defaultBranch)}</p>` +
		lastCommit(b) +
		files(b, defaultBranch) +
		'</article>'
	);
}

function renderOverlaps(overlaps: FileOverlap[]): string {
	if (overlaps.length === 0) {
		return '';
	}
	const items = overlaps
		.map(o => `<li><code class="path">${escapeHtml(o.file)}</code> on ${o.branches.map(b => `<strong>${escapeHtml(b)}</strong>`).join(' and ')}</li>`)
		.join('');
	return (
		'<div class="notice">' +
		'<p><strong>These files are changed on more than one branch.</strong> Combining those branches later may need extra care, because Git asks you to choose when two branches change the same lines.</p>' +
		`<ul>${items}</ul>` +
		'</div>'
	);
}

export function renderBranches(snapshot: RepoSnapshot): string {
	const summaries = snapshot.branchSummaries;
	if (summaries.length === 0) {
		return card('Branches', emptyState('🌿', 'No branches with commits yet', 'Once you save your first commit, your branch will show up here.'));
	}
	const main = escapeHtml(snapshot.defaultBranch);
	const current = snapshot.isDetached
		? 'You are not on a branch right now.'
		: `You are on <strong>${escapeHtml(snapshot.currentBranch)}</strong>.`;
	const intro =
		`<p>${plural(summaries.length, 'branch', 'branches')} in this project. ${current} Each branch is compared with your copy of <strong>${main}</strong>.</p>` +
		'<p class="muted">A branch is a separate line of work. Comparing it with the main branch shows what it would add.</p>';
	const cards = orderBranches(summaries).map(b => renderBranchCard(b, snapshot.defaultBranch)).join('');
	const note = '<p class="muted">Counts only: Git Clarity does not list the individual commits on each branch yet.</p>';
	return card('Branches', intro + renderOverlaps(overlappingFiles(summaries)) + cards + note);
}
