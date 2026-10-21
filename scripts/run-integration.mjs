import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
// An extension that only the Default profile has, to tell profiles apart.
const fake = join(extensionsDir, 'fake.defaultonly-1.0.0');
mkdirSync(fake, { recursive: true });
writeFileSync(join(fake, 'package.json'), JSON.stringify({ name: 'defaultonly', publisher: 'fake', version: '1.0.0', engines: { vscode: '^1.90.0' } }));
writeFileSync(join(extensionsDir, 'extensions.json'), JSON.stringify([{ identifier: { id: 'fake.defaultonly' }, version: '1.0.0', location: { $mid: 1, path: fake, scheme: 'file' }, relativeLocation: 'fake.defaultonly-1.0.0' }]));
const git = (...args) => execFileSync('git', args, { cwd: workspace, stdio: 'ignore' });
git('init', '-q');
git('remote', 'add', 'origin', 'git@example.com:Acme/Demo.git');
writeFileSync(join(workspace, 'README.md'), 'demo\n');

function launch(phase) {
	const env = { ...process.env, TE_PHASE: phase, TE_RESULT_DIR: scratch, TE_USER_DATA: userDataDir };
	// An extension development window does not keep a --profile association, so the runner records it (see below).
	const profile = phase === 'profile0' ? ['--profile=IntegrationProfile'] : [];
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
		...profile,
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
for (const phase of (process.env.TE_PHASES ?? 'defaultProfile,phase0,phase1,phase2,phase3,phase4,alias,profile0,profile').split(',')) {
	process.stdout.write(`${phase} ... `);
	await launch(phase);
	if (phase === 'profile0') {
		// What VS Code records for a window opened in a profile: workspace URI -> profile folder.
		const storageFile = join(userDataDir, 'User', 'globalStorage', 'storage.json');
		const storage = JSON.parse(readFileSync(storageFile, 'utf8'));
		const location = storage.userDataProfiles.find(p => p.name === 'IntegrationProfile').location;
		storage.profileAssociations = { ...storage.profileAssociations, workspaces: { ...storage.profileAssociations?.workspaces, [pathToFileURL(workspace).toString()]: location } };
		writeFileSync(storageFile, JSON.stringify(storage));

		// An extension listed only by that profile and disabled there. It is not running, so it can only be found
		// by reading the profile's extensions.json.
		const only = join(extensionsDir, 'fake.profileonly-1.0.0');
		mkdirSync(only, { recursive: true });
		writeFileSync(join(only, 'package.json'), JSON.stringify({ name: 'profileonly', publisher: 'fake', version: '1.0.0', engines: { vscode: '^1.90.0' } }));
		const db = new DatabaseSync(join(userDataDir, 'User', 'profiles', location, 'globalStorage', 'state.vscdb'));
		db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)').run('extensionsIdentifiers/disabled', JSON.stringify([{ id: 'fake.profileonly' }]));
		db.close();
		writeFileSync(join(userDataDir, 'User', 'profiles', location, 'extensions.json'), JSON.stringify([{ identifier: { id: 'fake.profileonly' }, version: '1.0.0', location: { $mid: 1, path: only, scheme: 'file' }, relativeLocation: 'fake.profileonly-1.0.0' }]));
	}
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
