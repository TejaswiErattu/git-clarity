/**
 * Secret Guard tests.
 *
 * The first three suites run today against the implemented parts of secretGuard.ts.
 * The last suite is the executable spec for P1 (scanStagedDiff / scanPendingCommit).
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { matchIntent } from '../assistant/intentMatcher';
import { buildActionPlan } from '../git/gitActions';
import { getRepoSnapshot } from '../git/gitCommands';
import { RepoSnapshot } from '../git/types';
import {
	ACKNOWLEDGED_STATE_KEY,
	addToGitignore,
	buildIgnoreKey,
	checkCommitGuard,
	createAcknowledgedStore,
	createInMemoryAcknowledgedStore,
	fixGuidanceFor,
	MementoLike,
	scanPendingCommit,
	scanStagedDiff
} from '../safety/secretGuard';
import { SecretFinding } from '../safety/secretScanner';
import { cleanupTempDirs, commitFile, git, isolateGitEnv, makeTempRepo, restoreGitEnv, writeFile } from './helpers/tempRepo';

// AKIA + 16 upper-case alphanumerics, with nothing the placeholder filter would catch.
const FAKE_AWS_KEY = 'AKIA' + 'ZZ9Q4K2M7T1B8R3W';

function finding(overrides: Partial<SecretFinding> = {}): SecretFinding {
	return {
		file: 'config.js',
		line: 4,
		column: 12,
		ruleId: 'aws-access-key',
		label: 'AWS access key',
		severity: 'high',
		snippet: 'const key = "AKIA…8R3W";',
		...overrides
	};
}

function snapshotFor(repo: string): RepoSnapshot {
	return getRepoSnapshot(repo);
}

suite('secretGuard: acknowledgements', () => {
	test('buildIgnoreKey is stable for the same finding and changes with file, rule or snippet', () => {
		const key = buildIgnoreKey(finding());
		assert.strictEqual(key, buildIgnoreKey(finding({ line: 99, column: 1 })), 'line and column must not affect the key');
		assert.notStrictEqual(key, buildIgnoreKey(finding({ file: 'other.js' })));
		assert.notStrictEqual(key, buildIgnoreKey(finding({ ruleId: 'github-token' })));
		assert.notStrictEqual(key, buildIgnoreKey(finding({ snippet: 'const key = "AKIA…0000";' })));
		assert.ok(!key.includes(FAKE_AWS_KEY), 'the key must never contain the secret');
	});

	test('in-memory store acknowledges and unacknowledges', async () => {
		const store = createInMemoryAcknowledgedStore();
		const key = buildIgnoreKey(finding());
		assert.strictEqual(store.isAcknowledged(key), false);
		await store.acknowledge(key);
		assert.strictEqual(store.isAcknowledged(key), true);
		assert.deepStrictEqual(store.keys(), [key]);
		await store.unacknowledge(key);
		assert.strictEqual(store.isAcknowledged(key), false);
		assert.deepStrictEqual(store.keys(), []);
	});

	test('memento-backed store writes through to the memento and reads existing state', async () => {
		const backing: Record<string, unknown> = { [ACKNOWLEDGED_STATE_KEY]: ['already|there|abc'] };
		const memento: MementoLike = {
			get: <T>(key: string, defaultValue: T): T => (key in backing ? (backing[key] as T) : defaultValue),
			update: async (key, value) => {
				backing[key] = value;
			}
		};
		const store = createAcknowledgedStore(memento);
		assert.strictEqual(store.isAcknowledged('already|there|abc'), true, 'existing acknowledgements are loaded');
		await store.acknowledge('new|key|123');
		assert.deepStrictEqual(backing[ACKNOWLEDGED_STATE_KEY], ['already|there|abc', 'new|key|123']);
	});
});

suite('secretGuard: fix guidance', () => {
	test('names the file and line, never the full secret, and explains the consequence', () => {
		const guidance = fixGuidanceFor(finding());
		assert.strictEqual(guidance.title, 'AWS access key in config.js');
		assert.ok(guidance.what.includes('config.js') && guidance.what.includes('Line 4'));
		assert.ok(!JSON.stringify(guidance).includes(FAKE_AWS_KEY));
		assert.ok(/GitHub/.test(guidance.why), 'why should mention where the secret ends up');
		assert.ok(guidance.next.length > 20);
		assert.strictEqual(guidance.canAddToGitignore, false, 'an inline key in a source file is fixed in place, not ignored');
	});

	test('.env and private key files are offered "add to .gitignore"', () => {
		assert.strictEqual(fixGuidanceFor(finding({ file: '.env' })).canAddToGitignore, true);
		assert.strictEqual(fixGuidanceFor(finding({ file: 'config/.env.local' })).canAddToGitignore, true);
		assert.strictEqual(fixGuidanceFor(finding({ file: 'deploy/server.pem', ruleId: 'private-key', label: 'Private key block' })).canAddToGitignore, true);
		assert.strictEqual(fixGuidanceFor(finding({ file: 'src/environment.ts' })).canAddToGitignore, false);
	});
});

suite('secretGuard: addToGitignore', () => {
	suiteSetup(isolateGitEnv);
	suiteTeardown(() => {
		restoreGitEnv();
		cleanupTempDirs();
	});

	test('creates .gitignore, appends once with a trailing newline, and reports duplicates', () => {
		const repo = makeTempRepo();
		const first = addToGitignore(repo, '.env');
		assert.strictEqual(first.added, true);
		assert.strictEqual(first.gitignore, '.env\n');

		const again = addToGitignore(repo, '.env');
		assert.strictEqual(again.added, false);
		assert.strictEqual(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8'), '.env\n');

		fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules', 'utf8'); // no trailing newline
		const appended = addToGitignore(repo, 'secrets/key.pem');
		assert.strictEqual(appended.gitignore, 'node_modules\nsecrets/key.pem\n');
	});
});

suite('secretGuard: commit guard with the current scanner', () => {
	suiteSetup(isolateGitEnv);
	suiteTeardown(() => {
		restoreGitEnv();
		cleanupTempDirs();
	});

	test('a clean repo is never blocked and the commit plan builds normally', () => {
		const repo = makeTempRepo();
		commitFile(repo, 'README.md', '# hi\n', 'init');
		writeFile(repo, 'src/index.js', 'console.log("hello");\n');
		const guard = checkCommitGuard(repo, createInMemoryAcknowledgedStore());
		assert.strictEqual(guard.blocked, false);

		const plan = buildActionPlan(matchIntent('save my changes: add index'), repo, snapshotFor(repo));
		assert.ok(plan);
		assert.strictEqual(plan.blockedReason, undefined);
		assert.deepStrictEqual(plan.commands, ['git add -A', 'git commit -m "add index"']);
	});
});

// ---------------------------------------------------------------------------
// P1 spec.
// ---------------------------------------------------------------------------
suite('secretGuard: staged and pending scanning (P1 spec)', () => {
	suiteSetup(isolateGitEnv);
	suiteTeardown(() => {
		restoreGitEnv();
		cleanupTempDirs();
	});

	test('a fake AWS key on a staged added line is found with the right line number', () => {
		const repo = makeTempRepo();
		commitFile(repo, 'config.js', 'module.exports = {\n  region: "us-west-2"\n};\n', 'init');
		writeFile(repo, 'config.js', `module.exports = {\n  region: "us-west-2",\n  key: "${FAKE_AWS_KEY}"\n};\n`);
		git(repo, 'add', 'config.js');

		const result = scanStagedDiff(repo);
		assert.strictEqual(result.scannedFileCount, 1);
		assert.strictEqual(result.findings.length, 1);
		assert.strictEqual(result.findings[0].file, 'config.js');
		assert.strictEqual(result.findings[0].line, 3);
		assert.strictEqual(result.findings[0].ruleId, 'aws-access-key');
		assert.ok(!result.findings[0].snippet.includes(FAKE_AWS_KEY), 'snippet must be masked');
	});

	test('a placeholder like your_api_key_here is ignored', () => {
		const repo = makeTempRepo();
		commitFile(repo, 'README.md', '# hi\n', 'init');
		writeFile(repo, 'config.js', 'const api_key = "your_api_key_here";\n');
		git(repo, 'add', 'config.js');
		assert.strictEqual(scanStagedDiff(repo).findings.length, 0);
	});

	test('a staged .env file with a real-looking value is flagged', () => {
		const repo = makeTempRepo();
		commitFile(repo, 'README.md', '# hi\n', 'init');
		writeFile(repo, '.env', `AWS_ACCESS_KEY_ID=${FAKE_AWS_KEY}\n`);
		git(repo, 'add', '.env');
		const result = scanStagedDiff(repo);
		assert.strictEqual(result.findings.length, 1);
		assert.strictEqual(result.findings[0].file, '.env');
		assert.strictEqual(fixGuidanceFor(result.findings[0]).canAddToGitignore, true);
	});

	test('a secret already committed in an unchanged part of a file is not a staged finding', () => {
		const repo = makeTempRepo();
		commitFile(repo, 'config.js', `const key = "${FAKE_AWS_KEY}";\nconst region = "us-west-2";\n`, 'init');
		writeFile(repo, 'config.js', `const key = "${FAKE_AWS_KEY}";\nconst region = "eu-west-1";\n`);
		git(repo, 'add', 'config.js');
		assert.strictEqual(scanStagedDiff(repo).findings.length, 0, 'only added lines count');
	});

	test('line numbers are correct across a multi-hunk diff', () => {
		const repo = makeTempRepo();
		const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
		commitFile(repo, 'big.js', lines.join('\n') + '\n', 'init');
		const edited = [...lines];
		edited[2] = 'line 3 edited'; // hunk 1 at line 3
		edited.splice(17, 0, `const key = "${FAKE_AWS_KEY}";`); // hunk 2: inserted as new line 18
		writeFile(repo, 'big.js', edited.join('\n') + '\n');
		git(repo, 'add', 'big.js');

		const result = scanStagedDiff(repo);
		assert.strictEqual(result.findings.length, 1);
		assert.strictEqual(result.findings[0].line, 18);
	});

	test('an unstaged edit is not reported by scanStagedDiff but is by scanPendingCommit', () => {
		const repo = makeTempRepo();
		commitFile(repo, 'config.js', 'const region = "us-west-2";\n', 'init');
		writeFile(repo, 'config.js', `const region = "us-west-2";\nconst key = "${FAKE_AWS_KEY}";\n`);
		assert.strictEqual(scanStagedDiff(repo).findings.length, 0);
		const pending = scanPendingCommit(repo);
		assert.strictEqual(pending.findings.length, 1);
		assert.strictEqual(pending.findings[0].line, 2);
	});

	test('an untracked file with a key is reported by scanPendingCommit', () => {
		const repo = makeTempRepo();
		commitFile(repo, 'README.md', '# hi\n', 'init');
		writeFile(repo, 'notes.txt', `token ${FAKE_AWS_KEY}\n`);
		const pending = scanPendingCommit(repo);
		assert.strictEqual(pending.findings.length, 1);
		assert.strictEqual(pending.findings[0].file, 'notes.txt');
	});

	test('commit plan is blocked naming the file; acknowledging unblocks it', async () => {
		const repo = makeTempRepo();
		commitFile(repo, 'README.md', '# hi\n', 'init');
		writeFile(repo, 'config.js', `const key = "${FAKE_AWS_KEY}";\n`);
		const store = createInMemoryAcknowledgedStore();
		const match = matchIntent('save my changes: add config');

		const blocked = buildActionPlan(match, repo, snapshotFor(repo), { acknowledged: store });
		assert.ok(blocked?.blockedReason, 'plan must be blocked');
		assert.ok(blocked.blockedReason.includes('config.js'), 'reason names the file');
		assert.ok(blocked.blockedReason.includes('line 1'), 'reason names the line');
		assert.strictEqual(git(repo, 'log', '--oneline').split('\n').length, 2, 'nothing was committed');

		const guard = checkCommitGuard(repo, store);
		await store.acknowledge(buildIgnoreKey(guard.unacknowledged[0]));

		const unblocked = buildActionPlan(match, repo, snapshotFor(repo), { acknowledged: store });
		assert.strictEqual(unblocked?.blockedReason, undefined);
	});

	test('medium severity findings are shown but never block', () => {
		const repo = makeTempRepo();
		commitFile(repo, 'README.md', '# hi\n', 'init');
		writeFile(repo, 'app.js', 'const password = "hunter2hunter2";\n');
		const guard = checkCommitGuard(repo, createInMemoryAcknowledgedStore());
		assert.strictEqual(guard.findings.length, 1);
		assert.strictEqual(guard.findings[0].severity, 'medium');
		assert.strictEqual(guard.blocked, false);
	});
});

// ---------------------------------------------------------------------------
// P2 edge cases.
// ---------------------------------------------------------------------------
const OTHER_AWS_KEY = 'AKIA' + 'MNBVCXZLKJHGFDSA';

suite('secretGuard: edge cases', () => {
	suiteSetup(isolateGitEnv);
	suiteTeardown(() => {
		restoreGitEnv();
		cleanupTempDirs();
	});

	test('a repo with no commits reports tracked and untracked keys and blocks', () => {
		const repo = makeTempRepo();
		git(repo, 'update-ref', '-d', 'HEAD');
		git(repo, 'rm', '-r', '-f', '--cached', '.');
		writeFile(repo, 'config.js', `const key = "${FAKE_AWS_KEY}";\n`);
		git(repo, 'add', 'config.js');
		writeFile(repo, 'notes.txt', `token ${FAKE_AWS_KEY}\n`);

		const pending = scanPendingCommit(repo);
		const files = pending.findings.map(item => item.file).sort();
		assert.deepStrictEqual(files, ['config.js', 'notes.txt']);
		assert.ok(pending.findings.every(item => item.severity === 'high'));

		const guard = checkCommitGuard(repo, createInMemoryAcknowledgedStore());
		assert.strictEqual(guard.blocked, true);
	});

	test('a png with key-like bytes is skipped by both scans', () => {
		const repo = makeTempRepo();
		const bytes = Buffer.concat([Buffer.from([0]), Buffer.from(FAKE_AWS_KEY)]);
		fs.writeFileSync(path.join(repo, 'secret.png'), bytes);
		git(repo, 'add', 'secret.png');

		assert.strictEqual(scanStagedDiff(repo).findings.length, 0);
		assert.strictEqual(scanPendingCommit(repo).findings.length, 0);
	});

	test('a key committed earlier and left untouched is reported by neither scan', () => {
		const repo = makeTempRepo();
		commitFile(repo, 'config.js', `const key = "${FAKE_AWS_KEY}";\nconst region = "us-west-2";\n`, 'add key');
		writeFile(repo, 'config.js', `const key = "${FAKE_AWS_KEY}";\nconst region = "eu-west-1";\n`);
		git(repo, 'add', 'config.js');

		assert.strictEqual(scanStagedDiff(repo).findings.length, 0);
		assert.strictEqual(scanPendingCommit(repo).findings.length, 0);
	});

	test('two keys in one file stay blocked after acknowledging only one', async () => {
		const repo = makeTempRepo();
		writeFile(repo, 'config.js', `const a = "${FAKE_AWS_KEY}";\nconst b = "${OTHER_AWS_KEY}";\n`);
		const pending = scanPendingCommit(repo);
		assert.strictEqual(pending.findings.length, 2);
		const keys = pending.findings.map(item => buildIgnoreKey(item));
		assert.notStrictEqual(keys[0], keys[1]);

		const store = createInMemoryAcknowledgedStore();
		await store.acknowledge(keys[0]);
		const guard = checkCommitGuard(repo, store);
		assert.strictEqual(guard.blocked, true);
		assert.strictEqual(guard.unacknowledged.length, 1);
		assert.strictEqual(buildIgnoreKey(guard.unacknowledged[0]), keys[1]);
	});

	test('a medium-severity password is shown and never blocks', () => {
		const repo = makeTempRepo();
		writeFile(repo, 'app.js', 'const password = "hunter2hunter2";\n');
		const guard = checkCommitGuard(repo, createInMemoryAcknowledgedStore());
		assert.strictEqual(guard.findings.length, 1);
		assert.strictEqual(guard.findings[0].severity, 'medium');
		assert.strictEqual(guard.unacknowledged.length, 0);
		assert.strictEqual(guard.blocked, false);
	});

	test('an untracked file larger than 1 MiB is skipped quickly', () => {
		const repo = makeTempRepo();
		const body = `${FAKE_AWS_KEY}\n${'a'.repeat(1024 * 1024 + 1)}`;
		fs.writeFileSync(path.join(repo, 'huge.txt'), body);

		const started = Date.now();
		const pending = scanPendingCommit(repo);
		const elapsed = Date.now() - started;

		assert.strictEqual(pending.findings.length, 0);
		assert.ok(elapsed < 500, `scan took ${elapsed} ms`);
	});

	test('a file in node_modules is skipped even when untracked', () => {
		const repo = makeTempRepo();
		writeFile(repo, 'node_modules/pkg/index.js', `const key = "${FAKE_AWS_KEY}";\n`);

		assert.strictEqual(scanStagedDiff(repo).findings.length, 0);
		assert.strictEqual(scanPendingCommit(repo).findings.length, 0);
	});

	test('scanStagedDiff on a non-repo folder returns an empty result', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-clarity-not-a-repo-'));
		try {
			const result = scanStagedDiff(dir);
			assert.strictEqual(result.scannedFileCount, 0);
			assert.deepStrictEqual(result.findings, []);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
