import * as fs from 'fs';
import * as path from 'path';
import { ChangedFile, RepoSnapshot } from '../git/types';

export type SecretSeverity = 'high' | 'medium' | 'low';

export interface SecretFinding {
	file: string;
	line: number;
	column: number;
	ruleId: string;
	label: string;
	severity: SecretSeverity;
	snippet: string;
}

export interface SecretScanResult {
	scannedFileCount: number;
	findings: SecretFinding[];
	scannedAt: string;
}

interface SecretPattern {
	id: string;
	label: string;
	severity: SecretSeverity;
	regex: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
	{
		id: 'aws-access-key',
		label: 'AWS access key',
		severity: 'high',
		regex: /\b(AKIA[0-9A-Z]{16})\b/
	},
	{
		id: 'github-token',
		label: 'GitHub token',
		severity: 'high',
		regex: /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/
	},
	{
		id: 'google-api-key',
		label: 'Google API key',
		severity: 'high',
		regex: /\b(AIza[0-9A-Za-z\-_]{35})\b/
	},
	{
		id: 'openai-key',
		label: 'OpenAI API key',
		severity: 'high',
		regex: /\b(sk-[A-Za-z0-9]{20,})\b/
	},
	{
		id: 'slack-token',
		label: 'Slack token',
		severity: 'high',
		regex: /\b(xox[baprs]-[A-Za-z0-9\-]{10,})\b/
	},
	{
		id: 'stripe-key',
		label: 'Stripe secret key',
		severity: 'high',
		regex: /\b(sk_(live|test)_[A-Za-z0-9]{16,})\b/
	},
	{
		id: 'private-key',
		label: 'Private key block',
		severity: 'high',
		regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
	},
	{
		id: 'generic-secret',
		label: 'Hard-coded secret assignment',
		severity: 'medium',
		regex: /\b(?:api[_-]?key|secret[_-]?key|auth[_-]?token|access[_-]?token|password)\s*[:=]\s*['"]([^'"\s]{8,})['"]/i
	}
];

const SKIP_DIR_NAMES = new Set([
	'node_modules',
	'.git',
	'dist',
	'out',
	'build',
	'.next',
	'coverage',
	'vendor'
]);

const SKIP_EXTENSIONS = new Set([
	'.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
	'.woff', '.woff2', '.ttf', '.eot',
	'.zip', '.gz', '.tar', '.pdf',
	'.lock'
]);

const PLACEHOLDER_HINTS = [
	'your_',
	'your-',
	'example',
	'placeholder',
	'changeme',
	'replace_me',
	'xxx',
	'<your',
	'insert_',
	'todo',
	'fake',
	'dummy',
	'test_key',
	'not_a_real'
];

function normalizePath(filePath: string): string {
	return filePath.replace(/\\/g, '/');
}

export function shouldSkipFile(relativePath: string): boolean {
	const normalized = normalizePath(relativePath);
	const segments = normalized.split('/');
	if (segments.some(segment => SKIP_DIR_NAMES.has(segment))) {
		return true;
	}

	const ext = path.extname(normalized).toLowerCase();
	if (SKIP_EXTENSIONS.has(ext)) {
		return true;
	}

	const base = path.basename(normalized).toLowerCase();
	if (base === 'package-lock.json' || base === 'yarn.lock' || base === 'pnpm-lock.yaml') {
		return true;
	}

	return false;
}

function looksLikePlaceholder(value: string): boolean {
	const lower = value.toLowerCase();
	return PLACEHOLDER_HINTS.some(hint => lower.includes(hint));
}

function maskSecret(value: string): string {
	if (value.length <= 8) {
		return '****';
	}
	return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function buildSnippet(line: string, match: string): string {
	const trimmed = line.trim();
	const masked = trimmed.replace(match, maskSecret(match));
	return masked.length > 120 ? `${masked.slice(0, 117)}…` : masked;
}

function scanLine(
	file: string,
	lineNumber: number,
	line: string
): SecretFinding[] {
	const findings: SecretFinding[] = [];

	for (const pattern of SECRET_PATTERNS) {
		const match = pattern.regex.exec(line);
		if (!match) {
			continue;
		}

		const captured = match[1] ?? match[0];
		if (looksLikePlaceholder(captured)) {
			continue;
		}

		// Skip obvious comments pointing at docs/examples.
		const commentLike = /^\s*(?:\/\/|#|\*|<!--)/.test(line);
		if (commentLike && /example|placeholder|sample|docs/i.test(line)) {
			continue;
		}

		findings.push({
			file,
			line: lineNumber,
			column: (match.index ?? 0) + 1,
			ruleId: pattern.id,
			label: pattern.label,
			severity: pattern.severity,
			snippet: buildSnippet(line, captured)
		});
	}

	return findings;
}

/** Scan already-numbered lines. Callers decide which lines count (a diff hunk, or a whole file). */
export function scanLines(relativePath: string, lines: { line: number; text: string }[]): SecretFinding[] {
	const findings: SecretFinding[] = [];
	for (const entry of lines) {
		findings.push(...scanLine(relativePath, entry.line, entry.text));
	}
	return findings;
}

export function scanFile(cwd: string, relativePath: string): SecretFinding[] {
	if (shouldSkipFile(relativePath)) {
		return [];
	}

	const absolutePath = path.join(cwd, relativePath);
	let content: string;
	try {
		content = fs.readFileSync(absolutePath, 'utf8');
	} catch {
		return [];
	}

	// Skip very large files.
	if (content.length > 512_000) {
		return [];
	}

	if (content.includes('\u0000')) {
		return [];
	}

	const lines = content.split(/\r?\n/);
	return scanLines(relativePath, lines.map((text, index) => ({ line: index + 1, text: text ?? '' })));
}

export function collectScanTargets(snapshot: RepoSnapshot): string[] {
	const paths = new Set<string>();
	for (const file of snapshot.changedFiles) {
		paths.add(normalizePath(file.path));
	}
	return [...paths];
}

export function scanChangedFiles(cwd: string, changedFiles: ChangedFile[]): SecretScanResult {
	const findings: SecretFinding[] = [];
	const scannedPaths: string[] = [];

	for (const file of changedFiles) {
		const relativePath = normalizePath(file.path);
		if (shouldSkipFile(relativePath)) {
			continue;
		}
		scannedPaths.push(relativePath);
		findings.push(...scanFile(cwd, relativePath));
	}

	findings.sort((a, b) => {
		const fileCompare = a.file.localeCompare(b.file);
		if (fileCompare !== 0) {
			return fileCompare;
		}
		return a.line - b.line;
	});

	return {
		scannedFileCount: scannedPaths.length,
		findings,
		scannedAt: new Date().toLocaleTimeString()
	};
}

export function scanWorkspaceSecrets(cwd: string, snapshot: RepoSnapshot): SecretScanResult {
	return scanChangedFiles(cwd, snapshot.changedFiles);
}
