/**
 * Safety tab: Secret Guard findings in two sections, with plain-English guidance.
 * Pure string rendering. Buttons carry data-* attributes only; the extension validates every
 * action against the findings on screen before acknowledging, editing .gitignore or opening a file.
 * The tab never claims the repository is safe: a pattern scan cannot prove an absence of secrets.
 */

import { blockingCount, SafetyFindingView, SafetySectionView, SafetyView, severityLabel } from '../safetyModel';
import { card, escapeHtml } from './html';

export const BLOCKING_RULE = 'High-severity findings block the Assistant\'s commit until you remove them or acknowledge them. Medium and low findings are shown but never block.';
export const PATTERN_CAVEAT = 'Secret Guard checks for known secret patterns. It cannot prove there are no secrets, so look over what you commit.';

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

function severityBadge(f: SafetyFindingView): string {
	return `<span class="severity severity-${f.severity}">${severityLabel(f.severity)}</span>`;
}

function location(f: SafetyFindingView): string {
	const label = `${escapeHtml(f.file)}:${f.line}`;
	return `<button class="link" data-action="open-file" data-file="${escapeHtml(f.file)}" data-line="${f.line}" title="Open this file at line ${f.line}">${label}</button>`;
}

function details(f: SafetyFindingView): string {
	return [
		`<p><strong>What we found.</strong> ${escapeHtml(f.what)}</p>`,
		`<pre class="snippet">${escapeHtml(f.snippet)}</pre>`,
		`<p><strong>Why it matters.</strong> ${escapeHtml(f.why)}</p>`,
		`<p><strong>What to do next.</strong> ${escapeHtml(f.next)}</p>`
	].join('');
}

function gitignoreButton(f: SafetyFindingView): string {
	return f.canAddToGitignore
		? `<button class="secondary" data-action="safety-gitignore" data-file="${escapeHtml(f.file)}">Add to .gitignore</button>`
		: '';
}

function renderOpenFinding(f: SafetyFindingView): string {
	return (
		`<article class="finding finding-${f.severity}">` +
		`<div class="finding-head">${severityBadge(f)}<h3>${escapeHtml(f.title)}</h3>${location(f)}</div>` +
		details(f) +
		'<div class="row actions">' +
		`<button class="primary" data-action="safety-ack" data-key="${escapeHtml(f.key)}">Acknowledge</button>` +
		gitignoreButton(f) +
		'</div>' +
		'</article>'
	);
}

function renderAcknowledgedFinding(f: SafetyFindingView): string {
	return (
		'<details class="finding acknowledged">' +
		`<summary>${severityBadge(f)} Acknowledged · ${escapeHtml(f.title)} · ${escapeHtml(f.file)}:${f.line}</summary>` +
		`<p class="muted">You marked this as not a real secret. It no longer blocks a commit. ${location(f)}</p>` +
		details(f) +
		'<div class="row actions">' +
		`<button class="secondary" data-action="safety-unack" data-key="${escapeHtml(f.key)}">Undo acknowledge</button>` +
		'</div>' +
		'</details>'
	);
}

export function renderFinding(f: SafetyFindingView): string {
	return f.acknowledged ? renderAcknowledgedFinding(f) : renderOpenFinding(f);
}

function renderSection(title: string, intro: string, s: SafetySectionView): string {
	let body: string;
	if (s.error) {
		body = `<p class="blocked">Couldn't scan this part of your project, so nothing here was checked. Git said: ${escapeHtml(s.error)}</p>`;
	} else if (s.findings.length === 0) {
		body = `<p class="muted">No known secret patterns in ${plural(s.scannedFileCount, 'scanned file', 'scanned files')}.</p>`;
	} else {
		body = s.findings.map(renderFinding).join('');
	}
	return card(title, `<p class="muted">${escapeHtml(intro)}</p>${body}`);
}

function renderSummary(view: SafetyView | undefined, acknowledgedCount: number): string {
	const parts = [`<p>${escapeHtml(BLOCKING_RULE)}</p>`];
	if (view) {
		const blockers = blockingCount(view);
		parts.push(
			blockers > 0
				? `<p class="blocked">${plural(blockers, 'high-severity finding', 'high-severity findings')} will block a commit.</p>`
				: '<p>No unacknowledged high-severity findings in what you are about to commit.</p>'
		);
	}
	parts.push(`<p class="muted">${escapeHtml(PATTERN_CAVEAT)}</p>`);
	parts.push(`<p class="muted">${plural(acknowledgedCount, 'acknowledged finding', 'acknowledged findings')} in this workspace.</p>`);
	if (view?.notice) {
		parts.push(`<p class="notice">${escapeHtml(view.notice)}</p>`);
	}
	return card('Secret Guard', parts.join(''));
}

export function renderSafety(view: SafetyView | undefined, acknowledgedCount: number): string {
	const summary = renderSummary(view, acknowledgedCount);
	if (!view) {
		return summary + card('Scanning', '<p class="muted">Checking what you are about to commit…</p>');
	}
	return (
		summary +
		renderSection('Staged, about to be committed', 'Lines you have staged with git add. These go into the next commit.', view.staged) +
		renderSection(
			'In your working files',
			'Changed and new files that are not staged yet. Saving from the Assistant stages everything first, so these would be committed too.',
			view.working
		)
	);
}
