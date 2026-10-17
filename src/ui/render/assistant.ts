import { card, escapeHtml } from './html';

/**
 * Placeholder until T2 wires the Assistant. The input is real so the panel can already keep
 * what you typed across refreshes; the Plan button stays disabled until plans exist.
 */
export function renderAssistant(assistantInput: string): string {
	return card(
		'Assistant',
		'<p>Tell Git Clarity what you want to do, in plain English.</p>' +
			'<div class="row">' +
			`<input type="text" data-input="assistant" placeholder="For example: save my changes" value="${escapeHtml(assistantInput)}" aria-label="What do you want to do?">` +
			'<button class="primary" disabled>Plan</button>' +
			'</div>' +
			'<p class="muted">Plans that show the exact commands, a risk label and how to undo arrive in T2.</p>'
	);
}
