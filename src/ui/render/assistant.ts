/**
 * Assistant tab: composer, example chips, plan preview, unrecognized list and result.
 * Pure string rendering. Buttons only carry data-* attributes; the client script turns
 * clicks into messages, and only the extension ever runs Git.
 */

import { SUPPORTED_INTENTS } from '../../assistant/intentMatcher';
import { ActionPlan, GitActionResult, riskLabel } from '../../git/gitActions';
import { AssistantGuard, AssistantState, canConfirm } from '../assistantController';
import { card, escapeHtml } from './html';
import { renderFinding } from './safety';

export const NOTHING_RUNS_LINE = 'Nothing runs until you press Confirm.';
export const BLOCKED_HEADING = 'Blocked: Secret Guard stopped this commit';
export const ACKNOWLEDGE_WARNING = 'Only acknowledge a finding if you are sure it is not a real secret. Acknowledging lets this commit include that line.';

/** One plain-English sentence explaining the risk badge. Derived from risk and reversibility. */
export function riskReason(plan: Pick<ActionPlan, 'risk' | 'reversible'>): string {
	switch (plan.risk) {
		case 'safe':
			return 'This only reads information or is easy to reverse.';
		case 'careful':
			return plan.reversible ? 'This changes your project, but it can be undone.' : 'This changes something that is hard to take back.';
		case 'risky':
			return plan.reversible ? 'This could clash with work you have not saved yet.' : 'This cannot be undone. Read the warnings below first.';
	}
}

function renderChips(): string {
	const chips = SUPPORTED_INTENTS.map(intent => {
		const { label, insertText, autoSubmit } = intent.chip;
		return `<button class="chip" data-chip-text="${escapeHtml(insertText)}" data-chip-submit="${autoSubmit}" title="${escapeHtml(intent.description)}">${escapeHtml(label)}</button>`;
	}).join('');
	return `<div class="chips" aria-label="Examples">${chips}</div>`;
}

function renderComposer(input: string): string {
	return card(
		'Assistant',
		'<p>Tell Git Clarity what you want to do, in plain English.</p>' +
			'<div class="row">' +
			`<input type="text" data-input="assistant" placeholder="For example: save my changes: fixed the navbar" value="${escapeHtml(input)}" aria-label="What do you want to do?">` +
			'<button class="primary" data-action="assistant-ask">Ask</button>' +
			'</div>' +
			`<p class="muted">${NOTHING_RUNS_LINE}</p>` +
			renderChips()
	);
}

function list(items: string[], className = ''): string {
	const cls = className ? ` class="${className}"` : '';
	return `<ul${cls}>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function section(title: string, bodyHtml: string): string {
	return `<div class="plan-section"><h3>${escapeHtml(title)}</h3>${bodyHtml}</div>`;
}

function renderCommands(commands: string[]): string {
	if (commands.length === 0) {
		return '<p class="muted">Nothing will run.</p>';
	}
	return `<pre class="commands"><code>${commands.map(escapeHtml).join('\n')}</code></pre>`;
}

function renderRisk(plan: ActionPlan): string {
	return `<p><span class="risk risk-${plan.risk}">${riskLabel(plan.risk)}</span> ${escapeHtml(riskReason(plan))}</p>`;
}

/** Shown above the plan when Secret Guard blocks a commit: every blocking finding, with actions. */
function renderBlocked(plan: ActionPlan, guard: AssistantGuard): string {
	const locations = guard.findings.map(f => `${f.file} line ${f.line}`);
	const others = guard.otherCount > 0
		? `<p class="muted">${guard.otherCount} other ${guard.otherCount === 1 ? 'finding does' : 'findings do'} not block this commit. See the Safety tab.</p>`
		: '';
	return (
		'<div class="blocked-section">' +
		`<h3>${escapeHtml(BLOCKED_HEADING)}</h3>` +
		(plan.blockedReason ? `<p>${escapeHtml(plan.blockedReason)} You can also acknowledge it here.</p>` : '') +
		list(locations, 'blocked-locations') +
		`<p class="notice">${escapeHtml(ACKNOWLEDGE_WARNING)}</p>` +
		guard.findings.map(f => renderFinding(f, { gitignore: false, openButton: true })).join('') +
		others +
		'</div>'
	);
}

function renderPreview(state: AssistantState, plan: ActionPlan): string {
	const parts: string[] = [];
	const guardBlocked = state.guard?.blocked === true;
	if (state.notice) {
		parts.push(`<p class="notice">${escapeHtml(state.notice)}</p>`);
	}
	if (state.match?.confidence === 'medium') {
		parts.push('<p class="muted">Best guess from keywords. Check this is what you meant.</p>');
	}
	if (guardBlocked && state.guard) {
		parts.push(renderBlocked(plan, state.guard));
	} else if (plan.blockedReason) {
		parts.push(`<p class="blocked"><strong>Can't do this yet.</strong> ${escapeHtml(plan.blockedReason)}</p>`);
	}
	parts.push(renderRisk(plan));
	parts.push(section('What it does', `<p>${escapeHtml(plan.explanation)}</p>`));
	parts.push(section('Commands that will run', renderCommands(plan.commands)));
	if (plan.affected.length > 0) {
		parts.push(section('Affected', list(plan.affected, 'affected')));
	}
	if (plan.warnings.length > 0) {
		parts.push(section('Warnings', list(plan.warnings, 'warnings')));
	}
	parts.push(section('How to undo', `<p>${escapeHtml(plan.undoHint)}</p>`));
	const disabled = canConfirm(plan, state.guard) ? '' : ' disabled';
	parts.push(
		'<div class="row actions">' +
			`<button class="primary" data-action="assistant-confirm" data-preview-id="${state.previewId}"${disabled}>Confirm</button>` +
			'<button class="secondary" data-action="assistant-cancel">Cancel</button>' +
			'</div>'
	);
	return card(plan.title, parts.join(''));
}

function renderUnrecognized(input: string): string {
	const items = SUPPORTED_INTENTS.map(i => `<li><strong>${escapeHtml(i.title)}</strong>: ${escapeHtml(i.description)}</li>`).join('');
	return card(
		"I don't recognize that yet",
		`<p>I don't recognize "${escapeHtml(input)}" yet, so I won't guess. Here is what I can help with:</p>` +
			`<ul class="supported">${items}</ul>` +
			'<p class="muted">Pick an example above, or rephrase your request.</p>'
	);
}

function resultTitle(result: GitActionResult, notSaved: boolean): string {
	if (result.success) {
		return 'Done';
	}
	return notSaved ? 'Not saved' : 'Did not finish';
}

function renderResult(result: GitActionResult, canReturnToPlan: boolean): string {
	const details = result.details ? `<pre class="result-details">${escapeHtml(result.details)}</pre>` : '';
	const cls = result.success ? 'result-ok' : 'result-fail';
	const back = canReturnToPlan ? '<button class="primary" data-action="assistant-back">Back to plan</button>' : '';
	return card(
		resultTitle(result, canReturnToPlan),
		`<p class="${cls}">${escapeHtml(result.summary)}</p>${details}` +
			`<div class="row actions">${back}<button class="secondary" data-action="assistant-cancel">Ask something else</button></div>`
	);
}

function renderPhase(state: AssistantState): string {
	switch (state.phase) {
		case 'preview':
			return state.plan ? renderPreview(state, state.plan) : '';
		case 'unrecognized':
			return renderUnrecognized(state.input);
		case 'done':
			return state.result ? renderResult(state.result, state.canReturnToPlan === true) : '';
		case 'idle':
			return '';
	}
}

export function renderAssistant(state: AssistantState): string {
	return renderComposer(state.input) + renderPhase(state);
}
