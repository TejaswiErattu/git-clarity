/**
 * Throwaway git repos for tests. Everything lives under os.tmpdir() and is
 * deleted by cleanupTempDirs(); tests never touch the real workspace.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const createdDirs: string[] = [];
let savedEnv: { global?: string; nosystem?: string; configDir: string } | undefined;

/** Runs git with an argv array (no shell) and returns trimmed stdout. */
export function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function makeTempDir(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `git-clarity-${prefix}-`));
	createdDirs.push(dir);
	return dir;
}

function configureIdentity(cwd: string): void {
	git(cwd, 'config', 'user.name', 'Test User');
	git(cwd, 'config', 'user.email', 'test@example.com');
	git(cwd, 'config', 'commit.gpgsign', 'false');
}

/**
 * Points git at an empty global config and disables the system config, so a
 * developer's own settings (pull.ff=only, pull.rebase, signing) can't mask
 * or change test results. Call from suiteSetup; undo with restoreGitEnv.
 */
export function isolateGitEnv(): void {
	// Kept out of createdDirs so per-test cleanup doesn't delete it mid-suite.
	const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-clarity-config-'));
	savedEnv = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM, configDir };
	const globalConfig = path.join(configDir, 'gitconfig');
	fs.writeFileSync(globalConfig, '');
	process.env.GIT_CONFIG_GLOBAL = globalConfig;
	process.env.GIT_CONFIG_NOSYSTEM = '1';
}

export function restoreGitEnv(): void {
	if (!savedEnv) {
		return;
	}
	for (const [key, value] of [['GIT_CONFIG_GLOBAL', savedEnv.global], ['GIT_CONFIG_NOSYSTEM', savedEnv.nosystem]] as const) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	fs.rmSync(savedEnv.configDir, { recursive: true, force: true });
	savedEnv = undefined;
}

export function writeFile(repo: string, relPath: string, content: string): void {
	const full = path.join(repo, relPath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
}

export function commitFile(repo: string, relPath: string, content: string, message: string): void {
	writeFile(repo, relPath, content);
	git(repo, 'add', relPath);
	git(repo, 'commit', '-m', message);
}

/** A repo on branch main with identity set and one commit (README.md). */
export function makeTempRepo(): string {
	const repo = makeTempDir('repo');
	git(repo, 'init', '-b', 'main');
	configureIdentity(repo);
	commitFile(repo, 'README.md', 'hello\n', 'Initial commit');
	return repo;
}

/**
 * A bare "remote" plus two clones. Both clones commit different files on
 * main; clone A pushes, clone B fetches. Clone B is then 1 ahead and 1
 * behind origin/main: a diverged branch.
 */
export function makeDivergedClones(): { bare: string; a: string; b: string } {
	const seed = makeTempRepo();
	const bare = makeTempDir('bare');
	git(bare, 'init', '--bare', '-b', 'main');
	git(seed, 'remote', 'add', 'origin', bare);
	git(seed, 'push', '-u', 'origin', 'main');

	const clone = (name: string): string => {
		const dir = path.join(makeTempDir(name), 'work');
		execFileSync('git', ['clone', bare, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
		configureIdentity(dir);
		return dir;
	};
	const a = clone('cloneA');
	const b = clone('cloneB');

	commitFile(a, 'a.txt', 'from A\n', 'Commit from A');
	git(a, 'push');
	commitFile(b, 'b.txt', 'from B\n', 'Commit from B');
	git(b, 'fetch');
	return { bare, a, b };
}

export function cleanupTempDirs(): void {
	while (createdDirs.length > 0) {
		const dir = createdDirs.pop()!;
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
