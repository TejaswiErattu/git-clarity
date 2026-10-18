/**
 * Pure rendering for the dashboard webview: DashboardState in, HTML string out.
 * No vscode import, so src/test/render.test.ts can run against it directly.
 */

import { RepoSnapshot } from '../../git/types';
import { AssistantState } from '../assistantController';
import { SafetyView } from '../safetyModel';
import { renderActivity } from './activity';
import { renderAssistant } from './assistant';
import { renderBranches } from './branches';
import { renderHelpOverlay } from './help';
import { baseStyles, clientScript, cspMeta, emptyState, escapeHtml } from './html';
import { renderOverview } from './overview';
import { renderSafety } from './safety';

export type TabId = 'overview' | 'branches' | 'activity' | 'assistant' | 'safety';

export const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
	{ id: 'overview', label: 'Overview' },
	{ id: 'branches', label: 'Branches' },
	{ id: 'activity', label: 'Activity' },
	{ id: 'assistant', label: 'Assistant' },
	{ id: 'safety', label: 'Safety' }
];

export function isTabId(value: unknown): value is TabId {
	return typeof value === 'string' && TABS.some(t => t.id === value);
}

export interface DashboardState {
	/** undefined when no workspace folder is open. */
	snapshot: RepoSnapshot | undefined;
	activeTab: TabId;
	/** Assistant tab: typed input (kept across refreshes), matched intent, plan, result and phase. */
	assistant: AssistantState;
	/** Acknowledged Secret Guard findings in this workspace. */
	acknowledgedCount: number;
	/** Safety tab scan results. Undefined until the tab has been scanned. */
	safety?: SafetyView;
	/** First-run help overlay is showing. Missing means closed. */
	helpOpen?: boolean;
}

function renderTabBar(activeTab: TabId): string {
	const buttons = TABS.map(tab => {
		const active = tab.id === activeTab;
		return `<button class="tab${active ? ' active' : ''}" role="tab" data-tab="${tab.id}" aria-selected="${active}">${tab.label}</button>`;
	}).join('');
	return `<nav class="tabs" role="tablist">${buttons}</nav>`;
}

function renderHeader(snapshot: RepoSnapshot | undefined): string {
	const subtitle = snapshot?.isRepo && snapshot.currentBranch
		? `<span class="muted">${escapeHtml(snapshot.repoName)} · ${escapeHtml(snapshot.currentBranch)}</span>`
		: '';
	return `<header><h1>Git Clarity</h1><div class="row">${subtitle}<button class="secondary" data-action="refresh">Refresh</button><button class="secondary help-button" data-action="show-help" aria-label="Open help" title="Help">?</button></div></header>`;
}

function renderTab(state: DashboardState, snapshot: RepoSnapshot): string {
	switch (state.activeTab) {
		case 'overview':
			return renderOverview(snapshot);
		case 'branches':
			return renderBranches(snapshot);
		case 'activity':
			return renderActivity(snapshot);
		case 'assistant':
			return renderAssistant(state.assistant);
		case 'safety':
			return renderSafety(state.safety, state.acknowledgedCount);
	}
}

function renderBody(state: DashboardState): string {
	const { snapshot } = state;
	if (!snapshot) {
		return emptyState('📂', 'Open a folder to get started', 'Git Clarity shows what is happening in the folder you have open. Use File > Open Folder, then come back here.');
	}
	if (!snapshot.isRepo) {
		return emptyState(
			'🔍',
			`${snapshot.repoName} is not a Git repository yet`,
			'There is no Git history in this folder. Once it is a repository, this dashboard will show its branches, changes and activity.'
		);
	}
	return renderTabBar(state.activeTab) + renderTab(state, snapshot);
}

export function renderDashboardHtml(state: DashboardState, nonce: string, cspSource = ''): string {
	return [
		'<!DOCTYPE html>',
		'<html lang="en">',
		'<head>',
		'<meta charset="UTF-8">',
		cspMeta(nonce, cspSource),
		'<meta name="viewport" content="width=device-width, initial-scale=1.0">',
		'<title>Git Clarity</title>',
		`<style nonce="${nonce}">${baseStyles()}</style>`,
		'</head>',
		'<body>',
		renderHeader(state.snapshot),
		renderBody(state),
		renderHelpOverlay(state.helpOpen === true),
		`<script nonce="${nonce}">${clientScript()}</script>`,
		'</body>',
		'</html>'
	].join('\n');
}
