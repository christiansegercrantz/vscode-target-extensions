import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cleanupGlobalDisables } from './core/ownedMirror';

/** `vscode:uninstall` hook: best-effort removal of the global "Disable" entries this extension added. */
function userDataDirs(): string[] {
	const products = ['Code', 'Code - Insiders', 'VSCodium', 'Cursor'];
	const base = process.platform === 'darwin'
		? join(homedir(), 'Library', 'Application Support')
		: process.platform === 'win32'
			? process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
			: process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
	return products.map(p => join(base, p));
}

try {
	const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { publisher: string; name: string };
	cleanupGlobalDisables(userDataDirs(), `${manifest.publisher}.${manifest.name}`, message => console.error(message));
} catch (error) {
	console.error(error);
}
