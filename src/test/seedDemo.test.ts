/**
 * The demo seed must leave a repo the dashboard, Safety tab, and Assistant can all walk.
 */

import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getRepoSnapshot } from '../git/gitCommands';
import { scanPendingCommit } from '../safety/secretGuard';
import { isolateGitEnv, restoreGitEnv } from './helpers/tempRepo';

suite('seed demo repo', () => {
	suiteSetup(isolateGitEnv);
	suiteTeardown(restoreGitEnv);

	test('three branches, the expected working tree, and one high finding', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-clarity-seed-'));
		try {
			const script = path.resolve(__dirname, '../../scripts/seed-demo-repo.sh');
			execFileSync('bash', [script, dir], { stdio: ['ignore', 'pipe', 'pipe'] });

			const snapshot = getRepoSnapshot(dir);
			assert.strictEqual(snapshot.currentBranch, 'main');
			assert.deepStrictEqual(
				snapshot.branches.map(branch => branch.name).sort(),
				['feature/login', 'feature/navbar', 'main']
			);
			const login = snapshot.branchSummaries.find(branch => branch.name === 'feature/login');
			assert.ok(login, 'feature/login is missing');
			assert.strictEqual(login.commitsAhead, 3);

			const lines = snapshot.changedFiles.map(file => `${file.status} ${file.path}`);
			for (const expected of [' M src/index.js', 'M  src/utils.js', 'A  config.js', '?? .env', '?? notes.txt']) {
				assert.ok(lines.includes(expected), `${expected} missing from ${lines.join(' | ')}`);
			}

			const high = scanPendingCommit(dir).findings.filter(finding => finding.severity === 'high');
			assert.strictEqual(high.length, 1);
			assert.strictEqual(high[0].file, 'config.js');
			assert.strictEqual(high[0].line, 1);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
