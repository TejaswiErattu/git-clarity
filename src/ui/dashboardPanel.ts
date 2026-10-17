/**
 * The dashboard webview panel. One instance at a time; createOrShow reveals it if it exists.
 *
 * Refresh model: the repository snapshot is re-read every POLL_INTERVAL_MS and the whole page is
 * re-rendered from DashboardState. Rendering is skipped while an input has focus (so typing is
 * never interrupted) and when nothing changed (so the scroll position survives a quiet poll).
 */

import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { emptySnapshot, getRepoSnapshot } from '../git/gitCommands';
import { RepoSnapshot } from '../git/types';
import { AcknowledgedStore } from '../safety/secretGuard';
import { DashboardState, isTabId, renderDashboardHtml, TabId } from './render';

export const POLL_INTERVAL_MS = 4000;

type WebviewMessage =
	| { type: 'setTab'; tab: unknown }
	| { type: 'refresh' }
	| { type: 'focus'; focused: boolean; assistantInput?: unknown };

export class DashboardPanel {
	private static current: DashboardPanel | undefined;

	private readonly disposables: vscode.Disposable[] = [];
	private readonly timer: ReturnType<typeof setInterval>;
	private activeTab: TabId = 'overview';
	private assistantInput = '';
	private inputFocused = false;
	private snapshot: RepoSnapshot | undefined;
	private lastRendered = '';
	private renderPending = false;

	static createOrShow(context: vscode.ExtensionContext, store: AcknowledgedStore): DashboardPanel {
		if (DashboardPanel.current) {
			DashboardPanel.current.panel.reveal();
			return DashboardPanel.current;
		}
		const panel = vscode.window.createWebviewPanel('gitClarity.dashboard', 'Git Clarity', vscode.ViewColumn.One, {
			enableScripts: true,
			retainContextWhenHidden: true
		});
		DashboardPanel.current = new DashboardPanel(panel, store);
		context.subscriptions.push(DashboardPanel.current);
		return DashboardPanel.current;
	}

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		private readonly store: AcknowledgedStore
	) {
		this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
		this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleMessage(message), undefined, this.disposables);
		this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
		this.refresh();
	}

	private handleMessage(message: WebviewMessage): void {
		switch (message.type) {
			case 'setTab':
				if (isTabId(message.tab)) {
					this.activeTab = message.tab;
					this.render();
				}
				return;
			case 'refresh':
				this.refresh();
				return;
			case 'focus':
				this.setInputFocused(message.focused, message.assistantInput);
				return;
		}
	}

	private setInputFocused(focused: boolean, assistantInput: unknown): void {
		this.inputFocused = focused;
		if (typeof assistantInput === 'string') {
			this.assistantInput = assistantInput;
		}
		if (!focused && this.renderPending) {
			this.render();
		}
	}

	private poll(): void {
		if (this.panel.visible) {
			this.refresh();
		}
	}

	private refresh(): void {
		this.snapshot = this.readSnapshot();
		this.render();
	}

	private readSnapshot(): RepoSnapshot | undefined {
		const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!folder) {
			return undefined;
		}
		try {
			return getRepoSnapshot(folder);
		} catch {
			return emptySnapshot(folder);
		}
	}

	private render(): void {
		if (this.inputFocused) {
			this.renderPending = true;
			return;
		}
		const state: DashboardState = {
			snapshot: this.snapshot,
			activeTab: this.activeTab,
			assistantInput: this.assistantInput,
			acknowledgedCount: this.store.keys().length
		};
		const serialized = JSON.stringify(state);
		if (serialized === this.lastRendered) {
			return;
		}
		this.lastRendered = serialized;
		this.renderPending = false;
		const nonce = randomBytes(16).toString('base64');
		this.panel.webview.html = renderDashboardHtml(state, nonce, this.panel.webview.cspSource);
	}

	dispose(): void {
		clearInterval(this.timer);
		DashboardPanel.current = undefined;
		for (const d of this.disposables.splice(0)) {
			d.dispose();
		}
		this.panel.dispose();
	}
}
