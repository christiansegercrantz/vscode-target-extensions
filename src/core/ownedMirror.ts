import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DISABLED_KEY = 'extensionsIdentifiers/disabled';
const MIRROR_FILE = /^owned\.[^\\/]+\.json$/;

/**
 * Copy of the ids the tool disabled globally in one profile, kept in the extension's storage folder, which all
 * profiles share, so there is one file per profile. The uninstall hook runs as plain Node without the VS Code
 * API, so it cannot read the extension's state and relies on these files.
 */
export interface OwnedMirror {
	/** The profile's state database that holds VS Code's "Disable" list. */
	dbPath: string;
	ids: string[];
}

export function writeMirror(globalStoragePath: string, profileKey: string, dbPath: string, ids: string[]): void {
	const mirror: OwnedMirror = { dbPath, ids };
	mkdirSync(globalStoragePath, { recursive: true });
	writeFileSync(join(globalStoragePath, `owned.${profileKey}.json`), JSON.stringify(mirror));
}

interface Statement {
	get(...params: unknown[]): { value?: unknown } | undefined;
	run(...params: unknown[]): unknown;
}
interface Database {
	exec(sql: string): void;
	prepare(sql: string): Statement;
	close(): void;
}

function openDatabase(path: string): Database {
	// Loaded lazily: older runtimes have no node:sqlite, and the hook is best-effort.
	const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => Database };
	return new DatabaseSync(path);
}

function removeFromDisabledList(dbPath: string, ids: Set<string>): boolean {
	const db = openDatabase(dbPath);
	try {
		db.exec('PRAGMA busy_timeout = 3000');
		const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(DISABLED_KEY);
		if (typeof row?.value !== 'string') {
			return false;
		}
		const list = JSON.parse(row.value) as { id?: string }[];
		const kept = list.filter(e => !ids.has((e.id ?? '').toLowerCase()));
		if (kept.length === list.length) {
			return false;
		}
		if (kept.length) {
			db.prepare('UPDATE ItemTable SET value = ? WHERE key = ?').run(JSON.stringify(kept), DISABLED_KEY);
		} else {
			db.prepare('DELETE FROM ItemTable WHERE key = ?').run(DISABLED_KEY);
		}
		return true;
	} finally {
		db.close();
	}
}

function mirrorFiles(userDataDir: string, extensionId: string): string[] {
	const dir = join(userDataDir, 'User', 'globalStorage', extensionId);
	return existsSync(dir) ? readdirSync(dir).filter(f => MIRROR_FILE.test(f)).map(f => join(dir, f)) : [];
}

/** Removes the global "Disable" entries the tool added, in every profile that has a mirror under the given VS Code data folders. */
export function cleanupGlobalDisables(userDataDirs: string[], extensionId: string, log: (message: string) => void = () => undefined): number {
	let cleaned = 0;
	for (const dir of userDataDirs) {
		for (const file of mirrorFiles(dir, extensionId.toLowerCase())) {
			try {
				const mirror = JSON.parse(readFileSync(file, 'utf8')) as OwnedMirror;
				if (mirror.ids.length && existsSync(mirror.dbPath) && removeFromDisabledList(mirror.dbPath, new Set(mirror.ids))) {
					cleaned++;
				}
			} catch (error) {
				log(`Could not clean up ${file}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}
	return cleaned;
}
