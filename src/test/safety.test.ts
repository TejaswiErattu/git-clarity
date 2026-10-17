import * as assert from 'assert';
import { buildIgnoreKey, createInMemoryAcknowledgedStore } from '../safety/secretGuard';
import { SecretFinding, SecretScanResult } from '../safety/secretScanner';
import { escapeHtml } from '../ui/render/html';
import { BLOCKING_RULE, PATTERN_CAVEAT, renderSafety } from '../ui/render/safety';
import { blockingCount, buildSafetyView, runSafetyScan, SafetyView } from '../ui/safetyModel';
import { cleanupTempDirs, git, isolateGitEnv, makeTempRepo, writeFile } from './helpers/tempRepo';

// AKIA + 16 upper-case alphanumerics, with nothing the placeholder filter would catch.
const FAKE_AWS_KEY = 'AKIA' + 'ZZ9Q4K2M7T1B8R3W';

function finding(overrides: Partial<SecretFinding> = {}): SecretFinding {
	return {
		file: 'src/config.js',
		line: 3,
		column: 15,
		ruleId: 'aws-access-key',
		label: 'AWS access key',
		severity: 'high',
		snippet: 'const key = "AKIA…8R3W";',
		...overrides
	};
}

function result(findings: SecretFinding[], scannedFileCount = Math.max(1, findings.length)): SecretScanResult {
	return { findings, scannedFileCount, scannedAt: '2026-10-17T00:00:00.000Z' };
}

const NONE_ACKED = () => false;

function view(staged: SecretFinding[], pending: SecretFinding[], acked: string[] = []): SafetyView {
	return buildSafetyView(result(staged), result(pending), key => acked.includes(key));
}

function sectionHtml(html: string, title: string): string {
	const start = html.indexOf(`<h2>${title}</h2>`);
	assert.ok(start >= 0, `section "${title}" is present`);
	const next = html.indexOf('<section', start);
	return html.slice(start, next === -1 ? undefined : next);
}

const STAGED = 'Staged, about to be committed';
const WORKING = 'In your working files';

suite('Safety tab: view model and rendering', () => {
	suiteSetup(isolateGitEnv);
	suiteTeardown(cleanupTempDirs);

	test('a high-severity finding shows its badge, guidance, masked snippet, location and Acknowledge', () => {
		const f = finding();
		const v = view([f], [f]);
		const html = renderSafety(v, 0);
		const staged = sectionHtml(html, STAGED);
		assert.ok(staged.includes('<span class="severity severity-high">High</span>'));
		assert.ok(staged.includes('<h3>AWS access key in config.js</h3>'));
		assert.ok(staged.includes('Line 3 of src/config.js looks like a aws access key.'));
		assert.ok(staged.includes('<strong>Why it matters.</strong> Anyone who gets this key'));
		assert.ok(staged.includes('<strong>What to do next.</strong> Move the value into an environment variable'));
		assert.ok(staged.includes('<pre class="snippet">const key = &quot;AKIA…8R3W&quot;;</pre>'));
		assert.ok(staged.includes('data-action="open-file" data-file="src/config.js" data-line="3"'));
		assert.ok(staged.includes('>src/config.js:3</button>'));
		assert.ok(staged.includes(`data-action="safety-ack" data-key="${buildIgnoreKey(f)}">Acknowledge</button>`));
		assert.strictEqual(blockingCount(v), 1);
		assert.ok(html.includes('1 high-severity finding will block a commit.'));
		assert.ok(html.includes(escapeHtml(BLOCKING_RULE)));
	});

	test('medium and low findings show their badges and never count as blockers', () => {
		const medium = finding({ ruleId: 'generic-secret', label: 'Hard-coded password', severity: 'medium', line: 1 });
		const low = finding({ file: 'notes.md', ruleId: 'generic-secret', label: 'Possible token', severity: 'low', line: 9 });
		const v = view([], [medium, low]);
		const html = renderSafety(v, 0);
		assert.ok(html.includes('<span class="severity severity-medium">Medium</span>'));
		assert.ok(html.includes('<span class="severity severity-low">Low</span>'));
		assert.strictEqual(blockingCount(v), 0);
		assert.ok(html.includes('No unacknowledged high-severity findings in what you are about to commit.'));
	});

	test('an acknowledged finding is collapsed, still visible, has Undo and no longer blocks', () => {
		const f = finding();
		const key = buildIgnoreKey(f);
		const v = view([f], [], [key]);
		const html = renderSafety(v, 1);
		const staged = sectionHtml(html, STAGED);
		assert.ok(staged.includes('<details class="finding acknowledged">'));
		assert.ok(!staged.includes('<details class="finding acknowledged" open'), 'collapsed by default');
		assert.ok(staged.includes('Acknowledged · AWS access key in config.js · src/config.js:3'));
		assert.ok(staged.includes(`data-action="safety-unack" data-key="${key}">Undo acknowledge</button>`));
		assert.ok(!staged.includes('data-action="safety-ack"'));
		assert.strictEqual(blockingCount(v), 0);
		assert.ok(html.includes('1 acknowledged finding in this workspace.'));
	});

	test('unacknowledged findings are listed before acknowledged ones, high before medium', () => {
		const acked = finding({ file: 'a.js' });
		const medium = finding({ file: 'b.js', severity: 'medium', ruleId: 'generic-secret', label: 'Hard-coded password' });
		const high = finding({ file: 'c.js' });
		const v = view([acked, medium, high], [], [buildIgnoreKey(acked)]);
		assert.deepStrictEqual(v.staged.findings.map(f => f.file), ['c.js', 'b.js', 'a.js']);
	});

	test('a finding in both scans appears once, under Staged; pending-only findings go to working files', () => {
		const stagedEnv = finding({ file: '.env', line: 1, snippet: 'AWS_KEY=AKIA…8R3W' });
		const unstaged = finding({ file: 'src/config.js', line: 7 });
		const v = view([stagedEnv], [stagedEnv, unstaged]);
		assert.deepStrictEqual(v.staged.findings.map(f => f.file), ['.env']);
		assert.deepStrictEqual(v.working.findings.map(f => f.file), ['src/config.js']);
		const html = renderSafety(v, 0);
		assert.ok(sectionHtml(html, STAGED).includes('.env:1'));
		assert.ok(!sectionHtml(html, WORKING).includes('.env:1'));
		assert.ok(sectionHtml(html, WORKING).includes('src/config.js:7'));
		assert.strictEqual(blockingCount(v), 2);
	});

	test('Add to .gitignore appears only when the guidance allows it', () => {
		const env = finding({ file: 'config/.env', line: 2 });
		const js = finding({ file: 'src/config.js', line: 3 });
		const html = renderSafety(view([env], [env, js]), 0);
		assert.ok(sectionHtml(html, STAGED).includes('data-action="safety-gitignore" data-file="config/.env">Add to .gitignore</button>'));
		assert.ok(!sectionHtml(html, WORKING).includes('safety-gitignore'));
	});

	test('empty sections say how much was scanned and never claim the repository is safe', () => {
		const v = buildSafetyView(result([], 2), result([], 0), NONE_ACKED);
		const html = renderSafety(v, 0);
		assert.ok(sectionHtml(html, STAGED).includes('No known secret patterns in 2 scanned files.'));
		assert.ok(sectionHtml(html, WORKING).includes('No known secret patterns in 0 scanned files.'));
		assert.ok(html.includes(PATTERN_CAVEAT));
		assert.ok(!/\b(is|are|looks|all) safe\b|\bno secrets\b|safe to commit/i.test(html.replace(PATTERN_CAVEAT, '')));
	});

	test('before the first scan the tab says it is checking instead of showing results', () => {
		const html = renderSafety(undefined, 0);
		assert.ok(html.includes('Checking what you are about to commit'));
		assert.ok(html.includes(PATTERN_CAVEAT));
	});

	test('a failing scan shows an error in its own section and the other section still renders', () => {
		const err = Object.assign(new Error('Command failed: git diff'), { stderr: 'fatal: bad revision HEAD\nmore' });
		const v = buildSafetyView(err, result([finding()]), NONE_ACKED);
		const html = renderSafety(v, 0);
		assert.ok(sectionHtml(html, STAGED).includes("Couldn't scan this part of your project"));
		assert.ok(sectionHtml(html, STAGED).includes('Git said: fatal: bad revision HEAD'));
		assert.ok(!sectionHtml(html, STAGED).includes('more'));
		assert.ok(sectionHtml(html, WORKING).includes('src/config.js:3'));
	});

	test('runSafetyScan turns a throwing scanner into a section error instead of throwing', () => {
		const store = createInMemoryAcknowledgedStore();
		const v = runSafetyScan('/nowhere', store, {
			scanStagedDiff: () => {
				throw new Error('git exploded');
			},
			scanPendingCommit: () => result([], 0)
		});
		assert.strictEqual(v.staged.error, 'git exploded');
		assert.strictEqual(v.working.error, undefined);
	});

	test('file names, snippets and titles are escaped, including in data attributes', () => {
		const hostile = finding({
			file: 'src/<img src=x>"&\'.js',
			snippet: '<script>alert(1)</script> = "AKIA…8R3W"',
			label: '<b>Key</b>'
		});
		const html = renderSafety(view([hostile], [], []), 0);
		assert.ok(!html.includes('<script>alert(1)</script>'));
		assert.ok(!html.includes('<img src=x>'));
		assert.ok(!html.includes('<b>Key</b>'));
		assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
		assert.ok(html.includes('data-file="src/&lt;img src=x&gt;&quot;&amp;&#39;.js"'));
		assert.ok(!/\son[a-z]+=/i.test(html), 'no inline handlers');
	});

	test('a real staged .env key is found under Staged, masked, and the full key never appears', () => {
		const repo = makeTempRepo();
		writeFile(repo, '.env', `AWS_ACCESS_KEY_ID=${FAKE_AWS_KEY}\n`);
		git(repo, 'add', '.env');
		writeFile(repo, 'src/config.js', `const key = "${FAKE_AWS_KEY}";\n`);

		const store = createInMemoryAcknowledgedStore();
		const v = runSafetyScan(repo, store);
		assert.deepStrictEqual(v.staged.findings.map(f => f.file), ['.env']);
		assert.deepStrictEqual(v.working.findings.map(f => f.file), ['src/config.js']);
		assert.strictEqual(v.staged.findings[0].canAddToGitignore, true);

		const html = renderSafety(v, 0);
		assert.ok(!html.includes(FAKE_AWS_KEY), 'the full secret is never rendered');
		assert.ok(html.includes('AKIA…8R3W'));
		assert.ok(html.includes('2 high-severity findings will block a commit.'));
	});
});
