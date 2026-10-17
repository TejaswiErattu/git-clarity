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
`;
}

/**
 * The only script on the page. It forwards three messages to the extension:
 *   setTab  { tab }                      a tab button was clicked
 *   refresh {}                           the refresh button was clicked
 *   focus   { focused, assistantInput }  an input gained or lost focus (blur carries its value)
 */
export function clientScript(): string {
	return `
(function () {
	var vscode = acquireVsCodeApi();
	document.addEventListener('click', function (event) {
		var target = event.target instanceof Element ? event.target.closest('[data-tab],[data-action]') : null;
		if (!target) { return; }
		var tab = target.getAttribute('data-tab');
		if (tab) { vscode.postMessage({ type: 'setTab', tab: tab }); return; }
		if (target.getAttribute('data-action') === 'refresh') { vscode.postMessage({ type: 'refresh' }); }
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
