import { card } from './html';

/** Placeholder until the Safety tab prompt. The acknowledged count is real and comes from workspaceState. */
export function renderSafety(acknowledgedCount: number): string {
	const noun = acknowledgedCount === 1 ? 'finding' : 'findings';
	return card(
		'Secret Guard',
		`<p>${acknowledgedCount} acknowledged ${noun} in this workspace.</p>` +
			'<p class="muted">Scanning of the lines you are about to commit, with plain-English fix guidance, arrives with the Safety tab prompt.</p>'
	);
}
