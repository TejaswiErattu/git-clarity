import * as vscode from 'vscode';
import { createAcknowledgedStore } from './safety/secretGuard';
import { DashboardPanel } from './ui/dashboardPanel';

/**
 * Git Clarity entry point.
 *
 * The acknowledged store is built ONCE here and handed to the dashboard, which later passes
 * it to both buildActionPlan and executeAction (T2), so an acknowledged Secret Guard finding
 * stays acknowledged at execute time.
 */
export function activate(context: vscode.ExtensionContext): void {
	const acknowledged = createAcknowledgedStore(context.workspaceState);

	context.subscriptions.push(
		vscode.commands.registerCommand('gitClarity.openDashboard', () => {
			DashboardPanel.createOrShow(context, acknowledged);
		})
	);
}

export function deactivate(): void {}
