/**
 * The dashboard webview panel. One instance at a time; createOrShow reveals it if it exists.
 *
 * Refresh model: the repository snapshot is re-read every POLL_INTERVAL_MS and the whole page is
 * re-rendered from DashboardState. Rendering is skipped while an input has focus (so typing is
 * never interrupted) and when nothing changed (so the scroll position survives a quiet poll).
 */

import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildActionPlan, executeAction } from '../git/gitActions';
import { emptySnapshot, getRepoSnapshot } from '../git/gitCommands';
import { RepoSnapshot } from '../git/types';
import { AcknowledgedStore, checkCommitGuard, ignoreAndUntrack, MementoLike } from '../safety/secretGuard';
import { ask, AssistantDeps, AssistantState, backToPlan, cancel, confirm, initialAssistantState, refreshPreview } from './assistantController';
import { hasSeenHelp, markHelpSeen } from './firstRun';
import { DashboardState, isTabId, renderDashboardHtml, TabId } from './render';
import { findFindingByFile, findFindingByKey, findGitignoreCandidate, runSafetyScan, SafetyFindingView, SafetyView } from './safetyModel';

export const POLL_INTERVAL_MS = 4000;

type WebviewMessage =
	| { type: 'setTab'; tab: unknown }
	| { type: 'refresh' }
	| { type: 'focus'; focused: boolean; assistantInput?: unknown }
	| { type: 'assistantAsk'; text: unknown }
	| { type: 'assistantConfirm'; previewId: unknown }
	| { type: 'assistantCancel' }
	| { type: 'assistantBackToPlan' }
	| { type: 'showHelp' }
	| { type: 'hideHelp' }
	| { type: 'safetyAcknowledge'; key: unknown }
	| { type: 'safetyUnacknowledge'; key: unknown }
	| { type: 'safetyAddToGitignore'; file: unknown }
	| { type: 'openFile'; file: unknown; line: unknown };

export class DashboardPanel {
	private static current: DashboardPanel | undefined;

	private readonly disposables: vscode.Disposable[] = [];
	private readonly timer: ReturnType<typeof setInterval>;
	private activeTab: TabId = 'overview';
	private assistant: AssistantState = initialAssistantState();
	private inputFocused = false;
	private snapshot: RepoSnapshot | undefined;
	private safety: SafetyView | undefined;
	private lastRendered = '';
	private renderPending = false;
	/** First-run help overlay. Opens automatically until this workspace dismisses it once. */
	private helpOpen: boolean;

	static createOrShow(context: vscode.ExtensionContext, store: AcknowledgedStore): DashboardPanel {
		if (DashboardPanel.current) {
			DashboardPanel.current.panel.reveal();
			return DashboardPanel.current;
		}
		const panel = vscode.window.createWebviewPanel('gitClarity.dashboard', 'Git Clarity', vscode.ViewColumn.One, {
			enableScripts: true,
			retainContextWhenHidden: true
		});
		DashboardPanel.current = new DashboardPanel(panel, store, context.workspaceState);
		context.subscriptions.push(DashboardPanel.current);
		return DashboardPanel.current;
	}

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		private readonly store: AcknowledgedStore,
		private readonly workspaceState: MementoLike
	) {
		this.helpOpen = !hasSeenHelp(workspaceState);
		this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
		this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleMessage(message), undefined, this.disposables);
		this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
		this.refresh(true);
	}

	/** Used by gitClarity.resetFirstRun: show the overlay now if the dashboard is open. */
	static showHelpIfOpen(): void {
		if (DashboardPanel.current) {
			DashboardPanel.current.panel.reveal();
			DashboardPanel.current.setHelpOpen(true);
		}
	}

	/** Dismissing the overlay is what counts as "seen", so closing the panel first shows it again next time. */
	private async setHelpOpen(open: boolean): Promise<void> {
		this.helpOpen = open;
		this.render(true);
		if (!open) {
			await markHelpSeen(this.workspaceState);
		}
	}

	private handleMessage(message: WebviewMessage): void {
		switch (message.type) {
			case 'setTab':
				if (isTabId(message.tab)) {
					this.activeTab = message.tab;
					this.scanSafetyIfVisible();
					this.render();
				}
				return;
			case 'refresh':
				this.refresh();
				return;
			case 'focus':
				this.setInputFocused(message.focused, message.assistantInput);
				return;
			case 'assistantAsk':
				if (typeof message.text === 'string') {
					this.updateAssistant(ask(this.assistant, message.text, this.assistantDeps()));
				}
				return;
			case 'assistantConfirm':
				if (typeof message.previewId === 'number') {
					this.confirmAssistant(message.previewId);
				}
				return;
			case 'assistantCancel':
				this.updateAssistant(cancel(this.assistant));
				return;
			case 'showHelp':
				void this.setHelpOpen(true);
				return;
			case 'hideHelp':
				void this.setHelpOpen(false);
				return;
			case 'assistantBackToPlan':
				this.updateAssistant(backToPlan(this.assistant, this.assistantDeps()));
				return;
			case 'safetyAcknowledge':
				void this.setAcknowledged(message.key, true);
				return;
			case 'safetyUnacknowledge':
				void this.setAcknowledged(message.key, false);
				return;
			case 'safetyAddToGitignore':
				this.addFileToGitignore(message.file);
				return;
			case 'openFile':
				void this.openFinding(message.file, message.line);
				return;
		}
	}

	// ---- Safety tab -------------------------------------------------------

	/** Scans only while the Safety tab is showing, so the other tabs never pay for it. */
	private scanSafetyIfVisible(notice?: string): void {
		const cwd = this.workspaceFolder();
		if (this.activeTab !== 'safety' || !cwd || !this.snapshot?.isRepo) {
			return;
		}
		this.safety = { ...runSafetyScan(cwd, this.store), notice: notice ?? this.safety?.notice };
	}

	/** Findings the Assistant is showing in a blocked commit preview. */
	private assistantFindings(): SafetyFindingView[] {
		return this.assistant.phase === 'preview' ? this.assistant.guard?.findings ?? [] : [];
	}

	/**
	 * Acknowledge only a finding on screen (Safety tab or the Assistant's blocked preview);
	 * undo only a key that is actually acknowledged. Then rebuild an open Assistant preview,
	 * so acknowledging unblocks it and undoing blocks it again.
	 */
	private async setAcknowledged(key: unknown, acknowledged: boolean): Promise<void> {
		if (typeof key !== 'string') {
			return;
		}
		const onScreen = findFindingByKey(this.safety, key) || this.assistantFindings().some(f => f.key === key);
		if (acknowledged && onScreen) {
			await this.store.acknowledge(key);
		} else if (!acknowledged && this.store.isAcknowledged(key)) {
			await this.store.unacknowledge(key);
		} else {
			return;
		}
		this.scanSafetyIfVisible();
		this.assistant = refreshPreview(this.assistant, this.assistantDeps());
		this.render();
	}

	private addFileToGitignore(file: unknown): void {
		const cwd = this.workspaceFolder();
		if (typeof file !== 'string' || !cwd || !findGitignoreCandidate(this.safety, file)) {
			return;
		}
		let notice: string;
		try {
			notice = ignoreAndUntrack(cwd, file).message;
		} catch (err) {
			notice = `Couldn't update .gitignore: ${err instanceof Error ? err.message : String(err)}`;
		}
		this.snapshot = this.readSnapshot();
		this.scanSafetyIfVisible(notice);
		this.render();
	}

	/** Opens a finding's file at its line. Only files listed on screen, only inside the workspace. */
	private async openFinding(file: unknown, line: unknown): Promise<void> {
		const cwd = this.workspaceFolder();
		const onScreen = typeof file === 'string' && (findFindingByFile(this.safety, file) || this.assistantFindings().some(f => f.file === file));
		if (typeof file !== 'string' || !cwd || !onScreen) {
			return;
		}
		const root = path.resolve(cwd);
		const target = path.resolve(root, file);
		if (!target.startsWith(root + path.sep)) {
			return;
		}
		const lineIndex = Math.max(0, (typeof line === 'number' && Number.isFinite(line) ? line : 1) - 1);
		try {
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
			const position = new vscode.Position(Math.min(lineIndex, Math.max(0, doc.lineCount - 1)), 0);
			await vscode.window.showTextDocument(doc, { selection: new vscode.Range(position, position), preview: false });
		} catch {
			void vscode.window.showWarningMessage(`Git Clarity could not open ${file}. It may have been moved or deleted.`);
		}
	}

	/** Git access for the Assistant. The same acknowledged store goes to planning and execution. */
	private assistantDeps(): AssistantDeps {
		const acknowledged = this.store;
		return {
			cwd: this.workspaceFolder(),
			readSnapshot: () => this.readSnapshot(),
			buildPlan: (match, cwd, snapshot) => buildActionPlan(match, cwd, snapshot, { acknowledged }),
			execute: (match, cwd) => executeAction(match, cwd, { acknowledged }),
			checkGuard: cwd => checkCommitGuard(cwd, acknowledged)
		};
	}

	/** Assistant actions are explicit clicks, so they always render, even if the box still had focus. */
	private updateAssistant(next: AssistantState): void {
		this.assistant = next;
		this.inputFocused = false;
		this.render();
	}

	private confirmAssistant(previewId: number): void {
		const next = confirm(this.assistant, previewId, this.assistantDeps());
		const executed = next.phase === 'done' && next.result !== undefined && next !== this.assistant;
		this.assistant = next;
		this.inputFocused = false;
		if (executed) {
			this.refresh();
		} else {
			this.render();
		}
	}

	private setInputFocused(focused: boolean, assistantInput: unknown): void {
		this.inputFocused = focused;
		if (typeof assistantInput === 'string') {
			this.assistant = { ...this.assistant, input: assistantInput };
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

	private refresh(force = false): void {
		this.snapshot = this.readSnapshot();
		this.scanSafetyIfVisible();
		this.render(force);
	}

	private workspaceFolder(): string | undefined {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	}

	private readSnapshot(): RepoSnapshot | undefined {
		const folder = this.workspaceFolder();
		if (!folder) {
			return undefined;
		}
		try {
			return getRepoSnapshot(folder);
		} catch {
			return emptySnapshot(folder);
		}
	}

	/**
	 * Skipped while typing or while the help dialog is open, so a poll never steals focus.
	 * `force` is for explicit actions that must show their result (help open/close, first paint).
	 */
	private render(force = false): void {
		if (!force && (this.inputFocused || this.helpOpen)) {
			this.renderPending = true;
			return;
		}
		const state: DashboardState = {
			snapshot: this.snapshot,
			activeTab: this.activeTab,
			assistant: this.assistant,
			acknowledgedCount: this.store.keys().length,
			safety: this.safety,
			helpOpen: this.helpOpen
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
