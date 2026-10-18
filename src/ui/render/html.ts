/**
 * HTML building blocks for the dashboard webview.
 *
 * Everything here returns plain strings so the render layer can be unit tested without a
 * VS Code host. Rules:
 *   - Every piece of repo-derived text goes through escapeHtml before it reaches the page.
 *   - No inline event handlers (onclick=...): the CSP forbids them. The client script wires
 *     events through data-* attributes instead.
 *   - Colours come only from VS Code theme variables, so light, dark and high-contrast
 *     themes all work without extra CSS.
 */

const ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};

export function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, ch => ESCAPES[ch]);
}

export function card(title: string, bodyHtml: string): string {
	return `<section class="card"><h2>${escapeHtml(title)}</h2>${bodyHtml}</section>`;
}

/** A friendly "nothing here" block. `icon` is a short decorative string, e.g. an emoji. */
export function emptyState(icon: string, title: string, message: string): string {
	return [
		'<div class="empty">',
		`<div class="empty-icon" aria-hidden="true">${escapeHtml(icon)}</div>`,
		`<h2>${escapeHtml(title)}</h2>`,
		`<p>${escapeHtml(message)}</p>`,
		'</div>'
	].join('');
}

export function cspMeta(nonce: string, cspSource: string): string {
	const policy = `default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
	return `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
}

export function baseStyles(): string {
	return `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
	margin: 0;
	padding: 16px 20px 32px;
	color: var(--vscode-foreground);
	background: var(--vscode-editor-background);
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size, 13px);
	line-height: 1.5;
}
h1, h2, h3 { margin: 0 0 8px; font-weight: 600; }
h1 { font-size: 1.4em; }
h2 { font-size: 1.05em; }
p { margin: 0 0 8px; }
.muted { color: var(--vscode-descriptionForeground); }
code { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.95em; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid var(--vscode-panel-border, transparent); margin-bottom: 16px; }
.tab {
	appearance: none;
	border: none;
	border-bottom: 2px solid transparent;
	background: transparent;
	color: var(--vscode-descriptionForeground);
	font: inherit;
	padding: 6px 12px;
	cursor: pointer;
}
.tab:hover { color: var(--vscode-foreground); }
.tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder, currentColor); }
.tab:focus-visible, button:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.card {
	border: 1px solid var(--vscode-panel-border, transparent);
	background: var(--vscode-sideBar-background, transparent);
	border-radius: 6px;
	padding: 12px 14px;
	margin-bottom: 12px;
}
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px; }
.stat { border: 1px solid var(--vscode-panel-border, transparent); border-radius: 6px; padding: 10px 12px; }
.stat .label { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
.stat .value { font-size: 1.3em; font-weight: 600; word-break: break-all; }
ul.files { list-style: none; margin: 0; padding: 0; }
ul.files li { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border, transparent); }
ul.files li:last-child { border-bottom: none; }
ul.files .path { word-break: break-all; }
.badge {
	white-space: nowrap;
	font-size: 0.85em;
	padding: 1px 8px;
	border-radius: 10px;
	color: var(--vscode-badge-foreground);
	background: var(--vscode-badge-background);
}
button.primary, button.secondary {
	font: inherit;
	border: 1px solid var(--vscode-button-border, transparent);
	border-radius: 3px;
	padding: 5px 12px;
	cursor: pointer;
}
button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button.primary:hover { background: var(--vscode-button-hoverBackground); }
button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
button[disabled] { opacity: 0.6; cursor: not-allowed; }
input[type="text"] {
	font: inherit;
	width: 100%;
	max-width: 520px;
	padding: 6px 8px;
	color: var(--vscode-input-foreground);
	background: var(--vscode-input-background);
	border: 1px solid var(--vscode-input-border, transparent);
	border-radius: 3px;
}
input[type="text"]::placeholder { color: var(--vscode-input-placeholderForeground); }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.empty { text-align: center; padding: 40px 16px; max-width: 520px; margin: 0 auto; }
.empty-icon { font-size: 2.4em; margin-bottom: 8px; }
.empty p { color: var(--vscode-descriptionForeground); }
h3 { font-size: 0.95em; margin: 12px 0 4px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.chip {
	font: inherit;
	font-size: 0.92em;
	padding: 3px 10px;
	border-radius: 12px;
	border: 1px solid var(--vscode-button-border, var(--vscode-panel-border, transparent));
	color: var(--vscode-button-secondaryForeground);
	background: var(--vscode-button-secondaryBackground);
	cursor: pointer;
}
.chip:hover { background: var(--vscode-button-secondaryHoverBackground); }
.risk {
	display: inline-block;
	font-weight: 600;
	font-size: 0.85em;
	padding: 1px 10px;
	border-radius: 10px;
	border: 1px solid currentColor;
	margin-right: 6px;
}
.risk-safe { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
.risk-careful { color: var(--vscode-editorWarning-foreground, var(--vscode-foreground)); }
.risk-risky { color: var(--vscode-errorForeground, var(--vscode-foreground)); }
pre {
	margin: 0 0 8px;
	padding: 8px 10px;
	border-radius: 4px;
	white-space: pre-wrap;
	word-break: break-all;
	background: var(--vscode-textCodeBlock-background, transparent);
	font-family: var(--vscode-editor-font-family, monospace);
}
.plan-section ul { margin: 0 0 8px; padding-left: 20px; }
.notice, .blocked {
	padding: 8px 10px;
	border-radius: 4px;
	border-left: 3px solid var(--vscode-editorWarning-foreground, currentColor);
	background: var(--vscode-inputValidation-warningBackground, transparent);
}
.blocked { border-left-color: var(--vscode-errorForeground, currentColor); background: var(--vscode-inputValidation-errorBackground, transparent); }
.result-fail { color: var(--vscode-errorForeground); }
.actions { margin-top: 12px; }
.help-button { min-width: 28px; font-weight: 600; }
.help-backdrop {
	position: fixed;
	inset: 0;
	display: flex;
	align-items: flex-start;
	justify-content: center;
	padding: 24px 16px;
	background: color-mix(in srgb, var(--vscode-editor-background) 75%, transparent);
	z-index: 10;
}
.help-dialog {
	width: 100%;
	max-width: 640px;
	max-height: calc(100vh - 48px);
	overflow: auto;
	padding: 16px 20px;
	border-radius: 6px;
	color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
	background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
	border: 1px solid var(--vscode-editorWidget-border, var(--vscode-contrastBorder, var(--vscode-panel-border, currentColor)));
	outline: 1px solid var(--vscode-contrastBorder, transparent);
	box-shadow: 0 4px 16px var(--vscode-widget-shadow, transparent);
}
.help-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.help-head h2 { font-size: 1.2em; margin: 0; }
.help-close { font-size: 1.2em; line-height: 1; padding: 2px 10px; }
dl.help-tabs { margin: 0 0 8px; }
dl.help-tabs dt { font-weight: 600; margin-top: 8px; }
dl.help-tabs dd { margin: 2px 0 0 0; }
ul.help-intents { list-style: none; margin: 0; padding: 0; }
ul.help-intents li { padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border, transparent); }
ul.help-intents li:last-child { border-bottom: none; }
.sync {
	border: 1px solid var(--vscode-panel-border, transparent);
	border-left-width: 4px;
	border-radius: 4px;
	padding: 8px 12px;
	margin-bottom: 12px;
}
.sync.tone-ok { border-left-color: var(--vscode-testing-iconPassed, currentColor); }
.sync.tone-info { border-left-color: var(--vscode-focusBorder, currentColor); }
.sync.tone-warn { border-left-color: var(--vscode-editorWarning-foreground, currentColor); }
.tags { display: inline-flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.stage, .tag {
	white-space: nowrap;
	font-size: 0.85em;
	padding: 0 8px;
	border-radius: 10px;
	border: 1px solid currentColor;
}
.stage-staged { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
.stage-partly, .stage-unstaged { color: var(--vscode-editorWarning-foreground, var(--vscode-foreground)); }
.stage-untracked { color: var(--vscode-descriptionForeground); }
.stage-conflict { color: var(--vscode-errorForeground, var(--vscode-foreground)); }
.tag-current { color: var(--vscode-textLink-foreground, var(--vscode-foreground)); }
.tag-default { color: var(--vscode-descriptionForeground); }
ul.legend { list-style: none; margin: 8px 0 0; padding: 0; color: var(--vscode-descriptionForeground); }
ul.legend li { margin: 2px 0; }
.branch {
	border: 1px solid var(--vscode-panel-border, transparent);
	border-radius: 4px;
	padding: 10px 12px;
	margin: 10px 0;
}
.branch.current { border-left: 3px solid var(--vscode-focusBorder, currentColor); }
.branch-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.branch-head h3 { margin: 0; word-break: break-all; }
h3.day { margin-top: 14px; }
ul.commits { list-style: none; margin: 0; padding: 0; }
ul.commits li.commit { padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border, transparent); }
ul.commits li.commit:last-child { border-bottom: none; }
.commit-message { word-break: break-word; }
.blocked-section {
	border: 1px solid var(--vscode-errorForeground, currentColor);
	border-left-width: 4px;
	border-radius: 4px;
	padding: 10px 12px;
	margin: 0 0 12px;
	background: var(--vscode-inputValidation-errorBackground, transparent);
}
.blocked-section > h3 { color: var(--vscode-errorForeground); margin-top: 0; }
.severity {
	display: inline-block;
	font-weight: 600;
	font-size: 0.85em;
	padding: 1px 10px;
	border-radius: 10px;
	border: 1px solid currentColor;
	white-space: nowrap;
}
.severity-high { color: var(--vscode-errorForeground, var(--vscode-foreground)); }
.severity-medium { color: var(--vscode-editorWarning-foreground, var(--vscode-foreground)); }
.severity-low { color: var(--vscode-descriptionForeground); }
.finding {
	border: 1px solid var(--vscode-panel-border, transparent);
	border-left-width: 3px;
	border-radius: 4px;
	padding: 10px 12px;
	margin: 10px 0;
}
.finding-high { border-left-color: var(--vscode-errorForeground, currentColor); }
.finding-medium { border-left-color: var(--vscode-editorWarning-foreground, currentColor); }
.finding.acknowledged { opacity: 0.85; }
.finding summary { cursor: pointer; }
.finding-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.finding-head h3 { margin: 0; }
button.link {
	font: inherit;
	padding: 0;
	border: none;
	background: none;
	color: var(--vscode-textLink-foreground);
	text-decoration: underline;
	cursor: pointer;
	word-break: break-all;
}
button.link:hover { color: var(--vscode-textLink-activeForeground); }
`;
}

/**
 * The only script on the page. It forwards messages to the extension and never runs Git:
 *   setTab           { tab }                      a tab button was clicked
 *   refresh          {}                           the refresh button was clicked
 *   focus            { focused, assistantInput }  an input gained or lost focus (blur carries its value)
 *   assistantAsk     { text }                     Ask, Enter in the box, or an auto-submit chip
 *   assistantConfirm { previewId }                Confirm on the preview with that id
 *   assistantCancel  {}                           Cancel, or "Ask something else"
 *   assistantBackToPlan {}                        "Back to plan" on a Not saved result
 *   safetyAcknowledge / safetyUnacknowledge { key }   Acknowledge or Undo on a Secret Guard finding
 *   safetyAddToGitignore { file }                     Add to .gitignore on a finding that allows it
 *   openFile         { file, line }               a finding's file:line link
 *   showHelp / hideHelp {}                       the ? button, Got it, ×, or Escape
 * When the help dialog is open, focus starts inside it and Tab stays inside it. Closing it
 * returns focus to the ? button (remembered with the webview state across the re-render).
 * A chip that needs more typing only fills the box and focuses it.
 */
export function clientScript(): string {
	return `
(function () {
	var vscode = acquireVsCodeApi();
	function helpDialog() { return document.querySelector('.help-dialog'); }
	function focusables(root) {
		return Array.prototype.slice.call(root.querySelectorAll('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])'));
	}
	function hideHelp() {
		vscode.setState(Object.assign({}, vscode.getState() || {}, { returnFocus: 'help' }));
		vscode.postMessage({ type: 'hideHelp' });
	}
	(function restoreFocus() {
		var dialog = helpDialog();
		var saved = vscode.getState() || {};
		if (dialog) {
			var first = focusables(dialog)[0];
			if (first) { first.focus(); }
		} else if (saved.returnFocus === 'help') {
			var helpButton = document.querySelector('[data-action="show-help"]');
			if (helpButton) { helpButton.focus(); }
			vscode.setState(Object.assign({}, saved, { returnFocus: undefined }));
		}
	})();
	document.addEventListener('keydown', function (event) {
		var dialog = helpDialog();
		if (!dialog) { return; }
		if (event.key === 'Escape') { event.preventDefault(); hideHelp(); return; }
		if (event.key !== 'Tab') { return; }
		var items = focusables(dialog);
		if (items.length === 0) { return; }
		var first = items[0];
		var last = items[items.length - 1];
		if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
			event.preventDefault();
			first.focus();
		}
	});
	function assistantBox() { return document.querySelector('input[data-input="assistant"]'); }
	function ask(text) {
		var box = assistantBox();
		if (box) { box.blur(); }
		vscode.postMessage({ type: 'assistantAsk', text: text });
	}
	function fillBox(text) {
		var box = assistantBox();
		if (!box) { return; }
		box.value = text;
		box.focus();
		box.setSelectionRange(text.length, text.length);
	}
	document.addEventListener('click', function (event) {
		var target = event.target instanceof Element ? event.target.closest('[data-tab],[data-action],[data-chip-text]') : null;
		if (!target || target.hasAttribute('disabled')) { return; }
		var tab = target.getAttribute('data-tab');
		if (tab) { vscode.postMessage({ type: 'setTab', tab: tab }); return; }
		var chipText = target.getAttribute('data-chip-text');
		if (chipText !== null) {
			if (target.getAttribute('data-chip-submit') === 'true') { ask(chipText); } else { fillBox(chipText); }
			return;
		}
		var action = target.getAttribute('data-action');
		if (action === 'refresh') { vscode.postMessage({ type: 'refresh' }); }
		if (action === 'show-help') { vscode.postMessage({ type: 'showHelp' }); }
		if (action === 'hide-help') { hideHelp(); }
		if (action === 'assistant-ask') { var box = assistantBox(); ask(box ? box.value : ''); }
		if (action === 'assistant-confirm') {
			vscode.postMessage({ type: 'assistantConfirm', previewId: Number(target.getAttribute('data-preview-id')) });
		}
		if (action === 'assistant-cancel') { vscode.postMessage({ type: 'assistantCancel' }); }
		if (action === 'assistant-back') { vscode.postMessage({ type: 'assistantBackToPlan' }); }
		if (action === 'safety-ack') { vscode.postMessage({ type: 'safetyAcknowledge', key: target.getAttribute('data-key') }); }
		if (action === 'safety-unack') { vscode.postMessage({ type: 'safetyUnacknowledge', key: target.getAttribute('data-key') }); }
		if (action === 'safety-gitignore') { vscode.postMessage({ type: 'safetyAddToGitignore', file: target.getAttribute('data-file') }); }
		if (action === 'open-file') {
			vscode.postMessage({ type: 'openFile', file: target.getAttribute('data-file'), line: Number(target.getAttribute('data-line')) });
		}
	});
	document.addEventListener('keydown', function (event) {
		var el = event.target;
		if (event.key === 'Enter' && el instanceof HTMLInputElement && el.getAttribute('data-input') === 'assistant') {
			event.preventDefault();
			ask(el.value);
		}
	});
	document.addEventListener('focusin', function (event) {
		if (event.target instanceof Element && event.target.hasAttribute('data-input')) {
			vscode.postMessage({ type: 'focus', focused: true });
		}
	});
	document.addEventListener('focusout', function (event) {
		var el = event.target;
		if (el instanceof HTMLInputElement && el.getAttribute('data-input') === 'assistant') {
			vscode.postMessage({ type: 'focus', focused: false, assistantInput: el.value });
		}
	});
})();
`;
}
