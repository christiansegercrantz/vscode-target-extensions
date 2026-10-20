import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { cleanupGlobalDisables, writeMirror } from '../src/core/ownedMirror';

const KEY = 'extensionsIdentifiers/disabled';
const EXT = 'me.target-extensions';

function setup(profile?: string) {
	const root = mkdtempSync(join(tmpdir(), 'te-uninstall-'));
	const globalStorage = profile ? join(root, 'User', 'profiles', profile, 'globalStorage') : join(root, 'User', 'globalStorage');
	mkdirSync(join(globalStorage, EXT), { recursive: true });
	const dbPath = join(globalStorage, 'state.vscdb');
	const db = new DatabaseSync(dbPath);
	db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
	return { root, globalStorage: join(globalStorage, EXT), db, dbPath };
}

const disabledList = (db: DatabaseSync) => {
	const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(KEY) as { value: string } | undefined;
	return row ? (JSON.parse(row.value) as { id: string }[]).map(e => e.id) : undefined;
};

describe('cleanupGlobalDisables', () => {
	it('removes only the ids the tool added, leaving the user entries', () => {
		const { root, globalStorage, db } = setup();
		db.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(KEY, JSON.stringify([{ id: 'user.disabled' }, { id: 'Mine.One', uuid: 'x' }, { id: 'mine.two' }]));
		writeMirror(globalStorage, ['mine.one', 'mine.two']);
		expect(cleanupGlobalDisables([root], EXT)).toBe(1);
		expect(disabledList(db)).toEqual(['user.disabled']);
	});

	it('removes the key when nothing is left, and covers non-default profiles', () => {
		const { root, globalStorage, db } = setup('abc123');
		db.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(KEY, JSON.stringify([{ id: 'mine.one' }]));
		writeMirror(globalStorage, ['mine.one']);
		expect(cleanupGlobalDisables([root], EXT)).toBe(1);
		expect(disabledList(db)).toBeUndefined();
	});

	it('does nothing without a mirror, and survives a broken one', () => {
		const { root, globalStorage } = setup();
		expect(cleanupGlobalDisables([root], EXT)).toBe(0);
		writeFileSync(join(globalStorage, 'owned.json'), '{not json');
		const messages: string[] = [];
		expect(cleanupGlobalDisables([root, join(root, 'missing')], EXT, m => messages.push(m))).toBe(0);
		expect(messages).toHaveLength(1);
	});
});
