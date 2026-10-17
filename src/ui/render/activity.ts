import { RepoSnapshot } from '../../git/types';
import { card } from './html';

/** Placeholder until T4 builds the real Activity tab. Shows one true fact so the tab is not empty. */
export function renderActivity(snapshot: RepoSnapshot): string {
	const count = snapshot.commits.length;
	const fact = count === 0 ? 'No commits yet.' : `${count} recent ${count === 1 ? 'commit' : 'commits'} loaded.`;
	return card('Recent activity', `<p>${fact}</p><p class="muted">A readable timeline of who changed what arrives in T4.</p>`);
}
