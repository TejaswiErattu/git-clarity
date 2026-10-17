import * as vscode from 'vscode';
import { createAcknowledgedStore } from './safety/secretGuard';

/**
 * Git Clarity entry point.
 *
 * T1/T2 (Tejaswi): replace the placeholder command body with the dashboard webview.
 * Build the acknowledged store ONCE here and pass it to both buildActionPlan and
 * executeAction, so an acknowledged Secret Guard finding stays acknowledged at execute time.
 */
export function activate(context: vscode.ExtensionContext): void {
	const acknowledged = createAcknowledgedStore(context.workspaceState);

	context.subscriptions.push(
		vscode.commands.registerCommand('gitClarity.openDashboard', () => {
			// Placeholder until the dashboard panel lands.
			const count = acknowledged.keys().length;
			vscode.window.showInformationMessage(
				`Git Clarity: the dashboard is on its way. (${count} acknowledged Secret Guard finding${count === 1 ? '' : 's'} in this workspace.)`
			);
		})
	);
}

export function deactivate(): void {}
