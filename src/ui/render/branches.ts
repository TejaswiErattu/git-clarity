import { RepoSnapshot } from '../../git/types';
import { card, escapeHtml } from './html';

/** Placeholder until T4 builds the real Branches tab. Shows one true fact so the tab is not empty. */
export function renderBranches(snapshot: RepoSnapshot): string {
	const count = snapshot.branches.length;
	const noun = count === 1 ? 'branch' : 'branches';
	const current = snapshot.currentBranch ? ` You are on ${escapeHtml(snapshot.currentBranch)}.` : '';
	return card(
		'Branches',
		`<p>${count} ${noun} found in this repository.${current}</p>` +
			'<p class="muted">A plain-English comparison of each branch with main arrives in T4.</p>'
	);
}
