import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAC_CODE = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const code = process.env.VSCODE_PATH ?? (existsSync(MAC_CODE) ? MAC_CODE : 'code');
const TIMEOUT_MS = 90_000;

// Throwaway profile and workspace, so the real VS Code setup is never touched.
const scratch = mkdtempSync(join(tmpdir(), 'target-extensions-it-'));
const userDataDir = join(scratch, 'user-data');
const extensionsDir = join(scratch, 'extensions');
const workspace = join(scratch, 'demo');
for (const dir of [userDataDir, extensionsDir, workspace]) {
	mkdirSync(dir, { recursive: true });
}
const git = (...args) => execFileSync('git', args, { cwd: workspace, stdio: 'ignore' });
git('init', '-q');
git('remote', 'add', 'origin', 'git@example.com:Acme/Demo.git');
writeFileSync(join(workspace, 'README.md'), 'demo\n');

function launch(phase) {
	const env = { ...process.env, TE_PHASE: phase, TE_RESULT_DIR: scratch };
	delete env.ELECTRON_RUN_AS_NODE;
	const args = [
		workspace,
		`--user-data-dir=${userDataDir}`,
		`--extensions-dir=${extensionsDir}`,
		`--extensionDevelopmentPath=${root}`,
		`--extensionDevelopmentPath=${join(root, 'test', 'integration', 'harness')}`,
		'--disable-workspace-trust',
		'--disable-gpu',
		'--skip-release-notes',
		'--skip-welcome',
	];
	return new Promise(resolvePromise => {
		const child = spawn(code, args, { env, stdio: 'ignore' });
		const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
		child.on('exit', () => {
			clearTimeout(timer);
			resolvePromise();
		});
	});
}

let failed = false;
for (const phase of (process.env.TE_PHASES ?? 'phase0,phase1,phase2,phase3,phase4').split(',')) {
	process.stdout.write(`${phase} ... `);
	await launch(phase);
	const file = join(scratch, `${phase}.json`);
	const result = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { ok: false, error: 'no result: VS Code did not run the phase in time' };
	console.log(result.ok ? 'ok' : 'FAILED');
	if (!result.ok) {
		console.error(result.error);
		failed = true;
		break;
	}
}
if (process.env.TE_KEEP) {
	console.log(`kept ${scratch}`);
} else {
	rmSync(scratch, { recursive: true, force: true });
}
console.log(failed ? '\nIntegration tests FAILED' : '\nIntegration tests passed');
process.exit(failed ? 1 : 0);
