/**
 * First-run help: whether this workspace has dismissed the help overlay.
 * Stored in VS Code workspaceState, so it is per project and survives reloads.
 * Uses the MementoLike shape from Secret Guard so it is testable without the VS Code host.
 */

import { MementoLike } from '../safety/secretGuard';

export const HELP_SEEN_KEY = 'gitClarity.helpSeen';

export function hasSeenHelp(memento: MementoLike): boolean {
	return memento.get<boolean>(HELP_SEEN_KEY, false) === true;
}

export function markHelpSeen(memento: MementoLike): PromiseLike<void> {
	return memento.update(HELP_SEEN_KEY, true);
}

/** Clears the flag so the overlay shows again (gitClarity.resetFirstRun). */
export function resetHelpSeen(memento: MementoLike): PromiseLike<void> {
	return memento.update(HELP_SEEN_KEY, undefined);
}
