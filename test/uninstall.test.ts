import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { cleanupGlobalDisables, writeMirror } from '../src/core/ownedMirror';

const KEY = 'extensionsIdentifiers/disabled';
const EXT = 'me.target-extensions';

// The extension's own storage folder is shared by all profiles; each profile has its own state database.
function profileDb(root: string, profile?: string) {
	const dir = profile ? join(root, 'User', 'profiles', profile, 'globalStorage') : join(root, 'User', 'globalStorage');
	mkdirSync(dir, { recursive: true });
	const dbPath = join(dir, 'state.vscdb');
	const db = new DatabaseSync(dbPath);
	db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
	return { db, dbPath };
}

function setup(profile?: string) {
	const root = mkdtempSync(join(tmpdir(), 'te-uninstall-'));
	const globalStorage = join(root, 'User', 'globalStorage', EXT);
	mkdirSync(globalStorage, { recursive: true });
	return { root, globalStorage, ...profileDb(root, profile) };
}

const disabledList = (db: DatabaseSync) => {
	const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(KEY) as { value: string } | undefined;
	return row ? (JSON.parse(row.value) as { id: string }[]).map(e => e.id) : undefined;
};

describe('cleanupGlobalDisables', () => {
	it('cleans each profile with its own database and leaves the others alone', () => {
		const { root, globalStorage, db: defaultDb, dbPath: defaultPath } = setup();
		const work = profileDb(root, 'abc123');
		defaultDb.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(KEY, JSON.stringify([{ id: 'shared.id' }, { id: 'default.only' }]));
		work.db.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(KEY, JSON.stringify([{ id: 'shared.id' }, { id: 'work.only' }]));
		writeMirror(globalStorage, 'default', defaultPath, ['default.only']);
		writeMirror(globalStorage, 'abc123', work.dbPath, ['work.only']);
		expect(cleanupGlobalDisables([root], EXT)).toBe(2);
		expect(disabledList(defaultDb)).toEqual(['shared.id']);
		expect(disabledList(work.db)).toEqual(['shared.id']);
	});

	it('ignores the old single mirror, whose database path could be wrong', () => {
		const { root, globalStorage, db, dbPath } = setup();
		db.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(KEY, JSON.stringify([{ id: 'mine.one' }]));
		writeFileSync(join(globalStorage, 'owned.json'), JSON.stringify({ dbPath, ids: ['mine.one'] }));
		expect(cleanupGlobalDisables([root], EXT)).toBe(0);
		expect(disabledList(db)).toEqual(['mine.one']);
	});

	it('removes only the ids the tool added, leaving the user entries', () => {
		const { root, globalStorage, db, dbPath } = setup();
		db.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(KEY, JSON.stringify([{ id: 'user.disabled' }, { id: 'Mine.One', uuid: 'x' }, { id: 'mine.two' }]));
		writeMirror(globalStorage, 'default', dbPath, ['mine.one', 'mine.two']);
		expect(cleanupGlobalDisables([root], EXT)).toBe(1);
		expect(disabledList(db)).toEqual(['user.disabled']);
	});

	it('removes the key when nothing is left, in a non-default profile', () => {
		const { root, globalStorage, db, dbPath } = setup('abc123');
		db.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(KEY, JSON.stringify([{ id: 'mine.one' }]));
		writeMirror(globalStorage, 'abc123', dbPath, ['mine.one']);
		expect(cleanupGlobalDisables([root], EXT)).toBe(1);
		expect(disabledList(db)).toBeUndefined();
	});

	it('does nothing without a mirror, and survives a broken one', () => {
		const { root, globalStorage } = setup();
		expect(cleanupGlobalDisables([root], EXT)).toBe(0);
		writeFileSync(join(globalStorage, 'owned.default.json'), '{not json');
		const messages: string[] = [];
		expect(cleanupGlobalDisables([root, join(root, 'missing')], EXT, m => messages.push(m))).toBe(0);
		expect(messages).toHaveLength(1);
	});
});
