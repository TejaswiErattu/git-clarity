/**
 * Safety tab view model: turns Secret Guard scan results into what the tab shows.
 *
 * buildSafetyView is pure. runSafetyScan calls the real scanners, each in its own try/catch,
 * so a failing `git diff` becomes a message in one section instead of a broken dashboard.
 * Nothing here writes to the repository.
 */

import {
	AcknowledgedStore,
	buildIgnoreKey,
	fixGuidanceFor,
	scanPendingCommit,
	scanStagedDiff
} from '../safety/secretGuard';
import { SecretFinding, SecretScanResult, SecretSeverity } from '../safety/secretScanner';

export interface SafetyFindingView {
	/** buildIgnoreKey(finding): what Acknowledge stores. */
	key: string;
	severity: SecretSeverity;
	title: string;
	what: string;
	why: string;
	next: string;
	/** The scanner's masked snippet. The full secret is never part of the view. */
	snippet: string;
	file: string;
	line: number;
	acknowledged: boolean;
	canAddToGitignore: boolean;
}

export interface SafetySectionView {
	findings: SafetyFindingView[];
	scannedFileCount: number;
	/** Set when the scan failed. Findings are then empty. */
	error?: string;
}

export interface SafetyView {
	/** "Staged, about to be committed". */
	staged: SafetySectionView;
	/** "In your working files": pending-commit findings that are not already staged. */
	working: SafetySectionView;
	/** One-line result of the last action, e.g. the .gitignore outcome. */
	notice?: string;
}

export type ScanOutcome = SecretScanResult | Error;

export interface SafetyScanners {
	scanStagedDiff(cwd: string): SecretScanResult;
	scanPendingCommit(cwd: string): SecretScanResult;
}

const SEVERITY_ORDER: Record<SecretSeverity, number> = { high: 0, medium: 1, low: 2 };

export function severityLabel(severity: SecretSeverity): string {
	switch (severity) {
		case 'high':
			return 'High';
		case 'medium':
			return 'Medium';
		case 'low':
			return 'Low';
	}
}

/** One finding as the UI shows it: guidance from fixGuidanceFor, identity from buildIgnoreKey. */
export function toFindingView(finding: SecretFinding, isAcknowledged: (key: string) => boolean): SafetyFindingView {
	const key = buildIgnoreKey(finding);
	const guidance = fixGuidanceFor(finding);
	return {
		key,
		severity: finding.severity,
		title: guidance.title,
		what: guidance.what,
		why: guidance.why,
		next: guidance.next,
		snippet: finding.snippet,
		file: finding.file,
		line: finding.line,
		acknowledged: isAcknowledged(key),
		canAddToGitignore: guidance.canAddToGitignore
	};
}

/** Unacknowledged first, then high > medium > low, then file and line. */
function compareFindings(a: SafetyFindingView, b: SafetyFindingView): number {
	return (
		Number(a.acknowledged) - Number(b.acknowledged) ||
		SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
		a.file.localeCompare(b.file) ||
		a.line - b.line
	);
}

function firstLine(error: Error): string {
	const stderr = (error as { stderr?: Buffer | string }).stderr?.toString().trim();
	const text = stderr || error.message || 'Unknown error';
	return text.split('\n')[0];
}

function section(outcome: ScanOutcome, isAcknowledged: (key: string) => boolean, skipKeys: Set<string>): SafetySectionView {
	if (outcome instanceof Error) {
		return { findings: [], scannedFileCount: 0, error: firstLine(outcome) };
	}
	const findings = outcome.findings
		.map(f => toFindingView(f, isAcknowledged))
		.filter(f => !skipKeys.has(f.key))
		.sort(compareFindings);
	return { findings, scannedFileCount: outcome.scannedFileCount };
}

/**
 * The pending scan already includes everything staged, so a pending finding whose ignore key
 * also appears in the staged scan is shown once, under Staged.
 */
export function buildSafetyView(staged: ScanOutcome, pending: ScanOutcome, isAcknowledged: (key: string) => boolean): SafetyView {
	const stagedSection = section(staged, isAcknowledged, new Set());
	const stagedKeys = new Set(stagedSection.findings.map(f => f.key));
	return { staged: stagedSection, working: section(pending, isAcknowledged, stagedKeys) };
}

function attempt(scan: () => SecretScanResult): ScanOutcome {
	try {
		return scan();
	} catch (err) {
		return err instanceof Error ? err : new Error(String(err));
	}
}

export function runSafetyScan(
	cwd: string,
	store: AcknowledgedStore,
	scanners: SafetyScanners = { scanStagedDiff, scanPendingCommit }
): SafetyView {
	const staged = attempt(() => scanners.scanStagedDiff(cwd));
	const pending = attempt(() => scanners.scanPendingCommit(cwd));
	return buildSafetyView(staged, pending, key => store.isAcknowledged(key));
}

export function allFindings(view: SafetyView): SafetyFindingView[] {
	return [...view.staged.findings, ...view.working.findings];
}

/** Unacknowledged high-severity findings: what blocks the Assistant's commit. */
export function blockingCount(view: SafetyView): number {
	return allFindings(view).filter(f => f.severity === 'high' && !f.acknowledged).length;
}

export function findFindingByKey(view: SafetyView | undefined, key: string): SafetyFindingView | undefined {
	return view ? allFindings(view).find(f => f.key === key) : undefined;
}

export function findFindingByFile(view: SafetyView | undefined, file: string): SafetyFindingView | undefined {
	return view ? allFindings(view).find(f => f.file === file) : undefined;
}

export function findGitignoreCandidate(view: SafetyView | undefined, file: string): SafetyFindingView | undefined {
	return view ? allFindings(view).find(f => f.file === file && f.canAddToGitignore) : undefined;
}
