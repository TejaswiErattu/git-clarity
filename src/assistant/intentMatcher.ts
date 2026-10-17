/**
 * Guided Git Assistant — intent matching.
 *
 * Turns a beginner's plain-English request (typed or picked from a chip)
 * into one of a small, fixed set of supported Git intents, and pulls out
 * any parameters (a commit message, a branch name) from the sentence.
 *
 * This module never touches Git and never runs anything — it only decides
 * *what the user probably meant*. Building the actual command plan and
 * executing it lives in `../git/gitActions`.
 */

export type IntentId =
	| 'status'
	| 'history'
	| 'commit'
	| 'undoLastCommit'
	| 'discardChanges'
	| 'newBranch'
	| 'switchBranch'
	| 'push'
	| 'pull';

/** How sure the matcher is about the user's request. Never guess past 'none'. */
export type Confidence = 'high' | 'medium' | 'none';

export interface IntentChip {
	/** Text shown on the suggestion chip. */
	label: string;
	/** Text inserted into the input box when the chip is clicked. */
	insertText: string;
	/** True when the request needs no further typing and can submit immediately. */
	autoSubmit: boolean;
}

export interface IntentDefinition {
	id: IntentId;
	/** Short human name shown in the "here's what I can help with" list. */
	title: string;
	/** One-line, beginner-friendly description of the request. */
	description: string;
	chip: IntentChip;
	needsMessage?: boolean;
	needsBranchName?: boolean;
	/** Phrases that count as a confident (exact-ish) match. */
	triggers: string[];
	/** Single words/short phrases used as a looser fallback match. */
	keywords: string[];
}

export interface IntentMatch {
	intentId: IntentId | null;
	confidence: Confidence;
	/** The raw text the user typed or picked, kept for display. */
	rawInput: string;
	/** Extracted commit message, present only when the intent needs one. */
	message?: string;
	/** Extracted branch name, present only when the intent needs one. */
	branchName?: string;
}

export const SUPPORTED_INTENTS: IntentDefinition[] = [
	{
		id: 'status',
		title: 'Show what changed',
		description: 'Lists files you have edited but not yet saved (committed).',
		chip: { label: 'What changed?', insertText: 'What changed in my project?', autoSubmit: true },
		triggers: ['what changed', "what's changed", 'show me what changed', 'show changed files', 'what did i change'],
		keywords: ['status', 'changed', 'changes']
	},
	{
		id: 'history',
		title: 'Show recent history',
		description: 'Shows your most recent commits, newest first.',
		chip: { label: 'Show recent history', insertText: 'Show me my recent commit history', autoSubmit: true },
		triggers: ['show me my recent commit history', 'show recent history', 'show me the commit history', 'show my commit history', 'recent commits', 'commit history'],
		keywords: ['history', 'commits', 'log']
	},
	{
		id: 'commit',
		title: 'Save my changes (commit)',
		description: 'Saves a checkpoint of your current work with a short note. Needs a message.',
		chip: { label: 'Save my changes', insertText: 'Save my changes: ', autoSubmit: false },
		needsMessage: true,
		triggers: ['save my changes', 'commit my changes'],
		keywords: ['commit', 'save']
	},
	{
		id: 'undoLastCommit',
		title: 'Undo my last commit',
		description: 'Removes your most recent commit but keeps the file changes, uncommitted.',
		chip: { label: 'Undo last commit', insertText: 'Undo my last commit', autoSubmit: true },
		triggers: ['undo my last commit', 'undo the last commit', 'undo last commit'],
		keywords: ['undo', 'uncommit']
	},
	{
		id: 'discardChanges',
		title: 'Discard my uncommitted changes',
		description: 'Throws away every unsaved edit and restores your last commit. Cannot be undone.',
		chip: { label: 'Discard my changes', insertText: 'Throw away my uncommitted changes', autoSubmit: true },
		triggers: ['throw away my uncommitted changes', 'discard my changes', 'discard my uncommitted changes', 'throw away my changes'],
		keywords: ['discard', 'throw away']
	},
	{
		id: 'newBranch',
		title: 'Create a new branch',
		description: 'Makes a separate copy of your project to work in safely. Needs a name.',
		chip: { label: 'Create a new branch', insertText: 'Create a new branch called ', autoSubmit: false },
		needsBranchName: true,
		triggers: ['create a new branch called', 'create a branch called', 'make a new branch called'],
		keywords: ['new branch', 'create branch', 'make branch']
	},
	{
		id: 'switchBranch',
		title: 'Switch branches',
		description: 'Moves you to a different existing branch. Needs a branch name.',
		chip: { label: 'Switch branches', insertText: 'Switch to branch called ', autoSubmit: false },
		needsBranchName: true,
		triggers: ['switch to branch called', 'switch to the branch called', 'switch branches to', 'switch to branch'],
		keywords: ['switch branch', 'change branch', 'switch to']
	},
	{
		id: 'push',
		title: 'Upload my changes',
		description: 'Uploads your saved commits to the shared remote (e.g. GitHub).',
		chip: { label: 'Upload my changes', insertText: 'Upload my committed changes to GitHub', autoSubmit: true },
		triggers: ['upload my committed changes to github', 'push my changes', 'upload my changes', 'send my changes to github'],
		keywords: ['push', 'upload']
	},
	{
		id: 'pull',
		title: 'Get the latest changes',
		description: 'Downloads new commits from the shared remote and combines them with your work.',
		chip: { label: 'Get the latest changes', insertText: 'Get the latest changes from GitHub', autoSubmit: true },
		triggers: ['get the latest changes from github', 'pull the latest changes', 'get the latest changes', 'download the latest changes'],
		keywords: ['pull', 'download changes', 'get latest']
	}
];

function extractMessage(input: string): string | undefined {
	const colonIdx = input.indexOf(':');
	if (colonIdx !== -1) {
		const after = input.slice(colonIdx + 1).trim();
		if (after) {
			return after;
		}
	}
	const asMatch = input.match(/\bas\s+(.+)$/i);
	if (asMatch?.[1]?.trim()) {
		return asMatch[1].trim();
	}
	return undefined;
}

function extractBranchName(input: string): string | undefined {
	let candidate: string | undefined;

	const calledMatch = input.match(/\b(?:called|named)\s+(.+)$/i);
	candidate = calledMatch?.[1];

	if (!candidate) {
		const colonIdx = input.indexOf(':');
		if (colonIdx !== -1) {
			candidate = input.slice(colonIdx + 1);
		}
	}

	if (!candidate) {
		const toMatch = input.match(/\bto\s+([a-zA-Z0-9._/-]+)\s*$/i);
		candidate = toMatch?.[1];
	}

	if (!candidate) {
		return undefined;
	}

	const cleaned = candidate.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/[.!?]+$/, '');
	return cleaned || undefined;
}

function finalizeMatch(intent: IntentDefinition, rawInput: string, confidence: Confidence): IntentMatch {
	return {
		intentId: intent.id,
		confidence,
		rawInput,
		message: intent.needsMessage ? extractMessage(rawInput) : undefined,
		branchName: intent.needsBranchName ? extractBranchName(rawInput) : undefined
	};
}

/**
 * A negation ("don't", "do not", "never") up to three words before a verb
 * that throws away or rewrites work. Such input matches nothing at all, so
 * "don't discard my changes" can never become a discard (or any other) plan.
 */
const NEGATED_DESTRUCTIVE = /\b(?:don['’]?t|not|never)\s+(?:\w+\s+){0,3}?(?:discard|throw away|undo|uncommit)\b/;

/**
 * Matches free-text input to a supported intent. Returns confidence 'none'
 * when nothing matches well enough — callers must never guess a command
 * in that case.
 */
export function matchIntent(rawInput: string): IntentMatch {
	const input = rawInput.trim();
	const normalized = input.toLowerCase();

	if (!normalized || NEGATED_DESTRUCTIVE.test(normalized)) {
		return { intentId: null, confidence: 'none', rawInput: input };
	}

	for (const intent of SUPPORTED_INTENTS) {
		if (intent.triggers.some(trigger => normalized.includes(trigger))) {
			return finalizeMatch(intent, input, 'high');
		}
	}

	let best: { intent: IntentDefinition; score: number } | undefined;
	for (const intent of SUPPORTED_INTENTS) {
		const score = intent.keywords.filter(keyword => normalized.includes(keyword)).length;
		if (score > 0 && (!best || score > best.score)) {
			best = { intent, score };
		}
	}
	if (best) {
		return finalizeMatch(best.intent, input, 'medium');
	}

	return { intentId: null, confidence: 'none', rawInput: input };
}
