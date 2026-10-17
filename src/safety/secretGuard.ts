/**
 * Secret Guard: the contract between the scanner backend and the dashboard UI.
 *
 * Agreed Sat Oct 17, 2026 at the DubHacks '26 kickoff.
 *   Backend owner: Thanishka (P1 scanning, P2 tests, P3 .gitignore action).
 *   UI owner:      Tejaswi  (T1 Safety tab, T2 Assistant block).
 * Do not change a signature in this file without telling the other person first.
 *
 * Implemented and working today:
 *   buildIgnoreKey, fixGuidanceFor, createAcknowledgedStore, createInMemoryAcknowledgedStore,
 *   addToGitignore, checkCommitGuard (correct as soon as the scan functions are real).
 *
 * Scanning:
 *   scanStagedDiff, scanPendingCommit.
 *
 * Design rules (from the Oct 1 plan):
 *   - Scan the diff, not whole files: only lines that are about to leave the machine count.
 *   - Acknowledge, never dismiss: an acknowledged finding is collapsed, not hidden, and the
 *     acknowledgement lives in workspaceState so it survives a reload but never leaks between projects.
 *   - Only HIGH severity blocks a commit. Medium and low are shown, never block.
 *   - Never silently allow, never permanently block.
 */

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SecretFinding, SecretScanResult, scanLines, shouldSkipFile } from './secretScanner';

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

interface NumberedLine {
	line: number;
	text: string;
}

interface ParsedDiffFile {
	path: string;
	added: NumberedLine[];
	/** Set once a hunk header has been seen, so '+++' inside a hunk stays an added line. */
	inHunk: boolean;
	newLine: number;
}

/** Same argv shape as runGitArgs, without importing the actions layer. Stdout is not trimmed. */
function runGit(cwd: string, args: string[]): string {
	return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

function hasHead(cwd: string): boolean {
	try {
		execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
		return true;
	} catch {
		return false;
	}
}

function nulPaths(output: string): string[] {
	return output.split('\0').filter(entry => entry.length > 0);
}

/** `+++ b/path` (or a quoted form). `/dev/null` is a deletion and has no new path. */
function destinationPath(header: string): string {
	let raw = header.trim();
	if (raw.startsWith('"') && raw.endsWith('"')) {
		raw = raw.slice(1, -1);
	}
	if (raw === '/dev/null') {
		return '';
	}
	return raw.startsWith('b/') ? raw.slice(2) : raw;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Added lines only, with the line number in the new file.
 * `--unified=0` emits no context lines; a space line would still advance the counter.
 */
function parseUnifiedDiff(diff: string): ParsedDiffFile[] {
	const files: ParsedDiffFile[] = [];
	let current: ParsedDiffFile | undefined;

	for (const line of diff.split('\n')) {
		if (line.startsWith('diff --git ')) {
			current = { path: '', added: [], inHunk: false, newLine: 0 };
			files.push(current);
			continue;
		}
		if (!current) {
			continue;
		}
		if (line.startsWith('Binary files ')) {
			current.inHunk = false;
			continue;
		}
		if (!current.inHunk && line.startsWith('+++ ')) {
			current.path = destinationPath(line.slice(4));
			continue;
		}
		const hunk = HUNK_HEADER.exec(line);
		if (hunk) {
			current.inHunk = true;
			current.newLine = Number(hunk[1]);
			continue;
		}
		if (!current.inHunk) {
			continue;
		}
		if (line.startsWith('+')) {
			current.added.push({ line: current.newLine, text: line.slice(1) });
			current.newLine++;
		} else if (line.startsWith(' ')) {
			current.newLine++;
		}
	}

	return files;
}

function sortFindings(findings: SecretFinding[]): SecretFinding[] {
	return findings.sort((a, b) => {
		const fileCompare = a.file.localeCompare(b.file);
		return fileCompare !== 0 ? fileCompare : a.line - b.line;
	});
}

function scanResult(scannedFileCount: number, findings: SecretFinding[]): SecretScanResult {
	return {
		scannedFileCount,
		findings: sortFindings(findings),
		scannedAt: new Date().toISOString()
	};
}

/** Every line of a working-tree file, numbered from 1. Caller has already applied shouldSkipFile. */
function scanWholeFile(cwd: string, relativePath: string): SecretFinding[] {
	let content: string;
	try {
		content = fs.readFileSync(path.join(cwd, relativePath), 'utf8');
	} catch {
		return [];
	}
	if (content.length > 512_000 || content.includes('\u0000')) {
		return [];
	}
	const lines = content.split('\n').map((text, index) => ({ line: index + 1, text }));
	return scanLines(relativePath, lines);
}

function findingsFromDiff(diff: string): { fileCount: number; paths: string[]; findings: SecretFinding[] } {
	const files = parseUnifiedDiff(diff);
	const findings: SecretFinding[] = [];
	const paths: string[] = [];
	for (const file of files) {
		if (file.path.length > 0) {
			paths.push(file.path);
			findings.push(...scanLines(file.path, file.added));
		}
	}
	return { fileCount: files.length, paths, findings };
}

/**
 * Scan only the lines that are staged.
 *
 * Implementation contract:
 *   - Run `git diff --cached --unified=0` with an argv array (execFileSync, never a shell string).
 *   - Consider only lines that start with a single '+' (skip the '+++ b/file' header).
 *   - Parse each `@@ -a,b +c,d @@` hunk header so `line` is the real line number in the
 *     staged version of the file; count only '+' and ' ' lines when advancing.
 *   - Reuse the patterns, placeholder filter and masking from secretScanner.ts. Do not read
 *     whole files here: a secret in an unchanged part of a file is NOT staged.
 *   - `scannedFileCount` is the number of files that appeared in the diff.
 */
export function scanStagedDiff(cwd: string): SecretScanResult {
	const diff = runGit(cwd, ['-c', 'core.quotePath=false', 'diff', '--cached', '--unified=0', '--no-color']);
	const { fileCount, findings } = findingsFromDiff(diff);
	return scanResult(fileCount, findings);
}

/**
 * Scan everything the Assistant's "save my changes" would actually commit.
 *
 * The commit plan runs `git add -A` before `git commit`, so "about to be committed" means:
 *   - added lines in `git diff HEAD --unified=0` (tracked files, staged or not), PLUS
 *   - every line of every untracked file from `git ls-files --others --exclude-standard`,
 *     treated as added (skip the same binary extensions and directories secretScanner skips).
 * Share the hunk parser with scanStagedDiff. On a repo with no commits yet, treat every
 * tracked and untracked file as fully added.
 */
export function scanPendingCommit(cwd: string): SecretScanResult {
	const findings: SecretFinding[] = [];
	let scannedFileCount = 0;
	const seen = new Set<string>();

	if (hasHead(cwd)) {
		const diff = runGit(cwd, ['-c', 'core.quotePath=false', 'diff', 'HEAD', '--unified=0', '--no-color']);
		const parsed = findingsFromDiff(diff);
		scannedFileCount += parsed.fileCount;
		for (const filePath of parsed.paths) {
			seen.add(filePath);
		}
		findings.push(...parsed.findings);
	} else {
		for (const relativePath of nulPaths(runGit(cwd, ['ls-files', '-z']))) {
			if (shouldSkipFile(relativePath) || seen.has(relativePath)) {
				continue;
			}
			seen.add(relativePath);
			scannedFileCount++;
			findings.push(...scanWholeFile(cwd, relativePath));
		}
	}

	const untracked = nulPaths(runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']));
	for (const relativePath of untracked) {
		if (shouldSkipFile(relativePath) || seen.has(relativePath)) {
			continue;
		}
		seen.add(relativePath);
		scannedFileCount++;
		findings.push(...scanWholeFile(cwd, relativePath));
	}

	return scanResult(scannedFileCount, findings);
}

// ---------------------------------------------------------------------------
// Acknowledgements (implemented)
// ---------------------------------------------------------------------------

/**
 * Stable identity for a finding across refreshes: file + rule + a hash of the masked snippet.
 * Deliberately excludes the line number, which moves as the file is edited.
 */
export function buildIgnoreKey(finding: SecretFinding): string {
	const digest = createHash('sha1').update(finding.snippet).digest('hex').slice(0, 12);
	return `${finding.file}|${finding.ruleId}|${digest}`;
}

/** The subset of vscode.Memento this module needs, so it can run outside the VS Code host. */
export interface MementoLike {
	get<T>(key: string, defaultValue: T): T;
	update(key: string, value: unknown): PromiseLike<void>;
}

export interface AcknowledgedStore {
	isAcknowledged(key: string): boolean;
	acknowledge(key: string): Promise<void>;
	unacknowledge(key: string): Promise<void>;
	keys(): string[];
}

export const ACKNOWLEDGED_STATE_KEY = 'gitClarity.secretGuard.acknowledged';

/**
 * Persist acknowledgements in `context.workspaceState` (pass it in from extension.ts).
 * workspaceState is per-workspace, so one project's acknowledgements never leak into another.
 */
export function createAcknowledgedStore(memento: MementoLike): AcknowledgedStore {
	const keys = new Set<string>(memento.get<string[]>(ACKNOWLEDGED_STATE_KEY, []));
	const persist = () => memento.update(ACKNOWLEDGED_STATE_KEY, [...keys]);
	return {
		isAcknowledged: key => keys.has(key),
		async acknowledge(key) {
			keys.add(key);
			await persist();
		},
		async unacknowledge(key) {
			keys.delete(key);
			await persist();
		},
		keys: () => [...keys]
	};
}

/** For tests and for building the UI before the extension context is wired through. */
export function createInMemoryAcknowledgedStore(initial: string[] = []): AcknowledgedStore {
	const memory = new Map<string, unknown>([[ACKNOWLEDGED_STATE_KEY, initial]]);
	return createAcknowledgedStore({
		get: <T>(key: string, defaultValue: T): T => (memory.has(key) ? (memory.get(key) as T) : defaultValue),
		update: async (key: string, value: unknown) => {
			memory.set(key, value);
		}
	});
}

// ---------------------------------------------------------------------------
// Fix guidance (implemented; refine the copy freely, keep the shape)
// ---------------------------------------------------------------------------

export interface FixGuidance {
	/** Max ~6 words, no rule id. e.g. "AWS access key in config.js" */
	title: string;
	/** One sentence naming the file and line. Never includes the full secret. */
	what: string;
	/** One or two sentences a 19-year-old understands. */
	why: string;
	/** The concrete next step. */
	next: string;
	/** True when the right fix is to keep the whole file out of Git (e.g. .env, *.pem). */
	canAddToGitignore: boolean;
}

const IGNORABLE_FILE = /(^|\/)(\.env(\..+)?|.+\.(pem|key|p12|pfx))$/i;

const WHY_BY_RULE: Record<string, string> = {
	'aws-access-key': 'Anyone who gets this key can run up charges on the AWS account it belongs to.',
	'github-token': 'Anyone who gets this token can act as you on GitHub: push code, read private repos, delete things.',
	'google-api-key': 'Anyone who gets this key can call Google services on your account and run up its quota or bill.',
	'openai-key': 'Anyone who gets this key can make requests billed to your OpenAI account.',
	'slack-token': 'Anyone who gets this token can read and post in your Slack workspace as you.',
	'stripe-key': 'Anyone who gets this key can see and move real money in the Stripe account.',
	'private-key': 'A private key is the master password for a server or an SSH identity. Whoever has it is you.',
	'generic-secret': 'A password or token written straight into code goes wherever the code goes, including GitHub.'
};

export function fixGuidanceFor(finding: SecretFinding): FixGuidance {
	const base = path.posix.basename(finding.file.replace(/\\/g, '/'));
	const canAddToGitignore = IGNORABLE_FILE.test(finding.file);
	const pushedWarning =
		'If this reaches GitHub, bots that scan for leaked keys find it within minutes, and deleting it in a later commit does not remove it from the history.';
	const why = `${WHY_BY_RULE[finding.ruleId] ?? 'Secrets in code end up everywhere the code goes.'} ${pushedWarning}`;

	let next: string;
	if (canAddToGitignore) {
		next = `Keep ${base} out of Git: add it to .gitignore, then load the values from environment variables instead. If the value is real, treat it as leaked and create a new one.`;
	} else if (finding.ruleId === 'private-key') {
		next = 'Remove the key from this file, generate a new key pair, and keep private keys outside the repo.';
	} else {
		next = 'Move the value into an environment variable (for example a .env file that is in .gitignore), then treat this key as leaked: create a new one and revoke this one.';
	}

	return {
		title: `${finding.label} in ${base}`,
		what: `Line ${finding.line} of ${finding.file} looks like a ${finding.label.toLowerCase()}.`,
		why,
		next,
		canAddToGitignore
	};
}

// ---------------------------------------------------------------------------
// Commit guard (implemented; depends on scanPendingCommit)
// ---------------------------------------------------------------------------

export interface CommitGuardResult {
	blocked: boolean;
	/** Plain English, names the first file and line. Set only when blocked. */
	blockedReason?: string;
	/** Every finding in what would be committed, acknowledged or not, any severity. */
	findings: SecretFinding[];
	/** HIGH severity findings that have not been acknowledged. Non-empty means blocked. */
	unacknowledged: SecretFinding[];
}

/**
 * Decide whether the Assistant's commit may proceed. buildActionPlan calls this for the
 * commit intent and copies `blockedReason` onto the plan; executeAction calls it again right
 * before `git add -A` so the UI can never bypass it. Pass the same store from both call sites.
 */
export function checkCommitGuard(cwd: string, store: AcknowledgedStore): CommitGuardResult {
	const { findings } = scanPendingCommit(cwd);
	const unacknowledged = findings.filter(f => f.severity === 'high' && !store.isAcknowledged(buildIgnoreKey(f)));
	if (unacknowledged.length === 0) {
		return { blocked: false, findings, unacknowledged };
	}
	const first = unacknowledged[0];
	const more = unacknowledged.length - 1;
	const andMore = more > 0 ? ` (and ${more} more)` : '';
	return {
		blocked: true,
		blockedReason: `${first.file} line ${first.line} looks like a ${first.label.toLowerCase()}${andMore}. Remove it, or acknowledge it in the Safety tab if it is not a real secret.`,
		findings,
		unacknowledged
	};
}

// ---------------------------------------------------------------------------
// .gitignore action (implemented)
// ---------------------------------------------------------------------------

export interface GitignoreResult {
	/** False when the path was already listed. */
	added: boolean;
	/** The full .gitignore contents after the call. */
	gitignore: string;
}

/**
 * Append a repo-relative path to .gitignore, once, with a trailing newline. Creates the file if
 * needed. Does not touch the index: if the file is already tracked, the UI should say so and
 * offer "git rm --cached" as a follow-up (that is a P3 extension, not in scope here).
 */
export function addToGitignore(cwd: string, relativePath: string): GitignoreResult {
	const target = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
	const file = path.join(cwd, '.gitignore');
	const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
	const lines = existing.split(/\r?\n/).map(l => l.trim());
	const alreadyListed = lines.includes(target) || lines.includes(`/${target}`);
	if (alreadyListed) {
		return { added: false, gitignore: existing };
	}
	const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
	const updated = `${existing}${separator}${target}\n`;
	fs.writeFileSync(file, updated, 'utf8');
	return { added: true, gitignore: updated };
}
