/**
 * First-run help overlay: what each tab is for, and every request the Assistant understands.
 * Pure string rendering. The "Things you can ask" list is generated from SUPPORTED_INTENTS,
 * so it can never drift from what the Assistant actually supports.
 */

import { IntentDefinition, SUPPORTED_INTENTS } from '../../assistant/intentMatcher';
import { escapeHtml } from './html';
import type { TabId } from './index';

export const TAB_HELP: ReadonlyArray<{ id: TabId; label: string; text: string }> = [
	{
		id: 'overview',
		label: 'Overview',
		text: 'See what changed since your last save (a commit), and whether you have work to upload to, or download from, the shared copy of the project (for example on GitHub).'
	},
	{
		id: 'branches',
		label: 'Branches',
		text: 'A branch is a separate line of work, a parallel version of the project. See how each one differs from the main branch.'
	},
	{
		id: 'activity',
		label: 'Activity',
		text: 'Your commits over time. A commit is a saved checkpoint with a short note about what changed.'
	},
	{
		id: 'assistant',
		label: 'Assistant',
		text: 'Ask for what you want in plain English. You see the exact commands, how risky they are and how to undo them, and nothing runs until you press Confirm.'
	},
	{
		id: 'safety',
		label: 'Safety',
		text: 'Secret Guard looks for things like passwords and API keys in what you are about to commit. A likely secret blocks the commit until you remove it, or tell Git Clarity it is not a real secret.'
	}
];

/** The example a user could type. Requests that need more words (a message, a name) end in "…". */
export function exampleFor(intent: Pick<IntentDefinition, 'chip'>): string {
	const text = intent.chip.insertText.trim();
	return intent.chip.autoSubmit ? text : `${text} …`;
}

function renderTabs(): string {
	const items = TAB_HELP.map(t => `<dt>${escapeHtml(t.label)}</dt><dd>${escapeHtml(t.text)}</dd>`).join('');
	return `<h3>The five tabs</h3><dl class="help-tabs">${items}</dl>`;
}

function renderIntents(intents: ReadonlyArray<Pick<IntentDefinition, 'title' | 'description' | 'chip'>>): string {
	const items = intents
		.map(i =>
			'<li class="help-intent">' +
			`<strong>${escapeHtml(i.title)}</strong>` +
			`<div><code>${escapeHtml(exampleFor(i))}</code></div>` +
			`<div class="muted">${escapeHtml(i.description)}</div>` +
			'</li>'
		)
		.join('');
	return `<h3>Things you can ask</h3><p class="muted">Type these into the Assistant, or click the matching example there.</p><ul class="help-intents">${items}</ul>`;
}

export function renderHelpOverlay(
	open: boolean,
	intents: ReadonlyArray<Pick<IntentDefinition, 'title' | 'description' | 'chip'>> = SUPPORTED_INTENTS
): string {
	if (!open) {
		return '';
	}
	return (
		'<div class="help-backdrop">' +
		'<div class="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" aria-describedby="help-intro">' +
		'<div class="help-head">' +
		'<h2 id="help-title">Welcome to Git Clarity</h2>' +
		'<button class="secondary help-close" data-action="hide-help" aria-label="Close help">×</button>' +
		'</div>' +
		'<p id="help-intro">Git keeps a history of your project. Git Clarity shows what is happening in plain words and never runs anything without asking you first.</p>' +
		renderTabs() +
		renderIntents(intents) +
		'<div class="row actions">' +
		'<button class="primary" data-action="hide-help">Got it</button>' +
		'<span class="muted">Open this again any time with the ? button.</span>' +
		'</div>' +
		'</div>' +
		'</div>'
	);
}
