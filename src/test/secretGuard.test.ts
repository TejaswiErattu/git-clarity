/**
 * Secret Guard tests.
 *
 * The first three suites run today against the implemented parts of secretGuard.ts.
 * The last suite is the executable spec for P1 (scanStagedDiff / scanPendingCommit):
 * it is `suite.skip` so CI stays green until the implementation lands. Remove `.skip`
 * as the first step of P1 and make it pass.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { matchIntent } from '../assistant/intentMatcher';
import { buildActionPlan } from '../git/gitActions';
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

/** Minimal snapshot for planning; only the fields planCommit reads. */
function snapshotFor(repo: string): RepoSnapshot {
	const status = git(repo, 'status', '--porcelain');
	const changedFiles = status
		.split('\n')
		.filter(line => line.length > 3)
		.map(line => ({ status: line.slice(0, 2), path: line.slice(3) }));
	return {
		isRepo: true,
		repoName: path.basename(repo),
		currentBranch: 'main',
		branches: [{ name: 'main', isCurrent: true }],
		commits: [],
		changedFileCount: changedFiles.length,
		changedFiles,
		aheadBehind: { ahead: 0, behind: 0, hasUpstream: false }
	};
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
// P1 spec. Remove `.skip` when implementing scanStagedDiff / scanPendingCommit.
// ---------------------------------------------------------------------------
suite.skip('secretGuard: staged and pending scanning (P1 spec)', () => {
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
		assert.strictEqual(git(repo, 'log', '--oneline').split('\n').length, 1, 'nothing was committed');

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
