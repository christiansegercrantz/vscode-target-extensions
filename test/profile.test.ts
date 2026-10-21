import { describe, expect, it } from 'vitest';
import { resolveProfile } from '../src/core/profile';

const UD = '/Users/me/Library/Application Support/Code';
const EXT = '/Users/me/.vscode/extensions';

const storage = {
	profileAssociations: {
		workspaces: {
			'file:///Users/me/code/api': '-3fe01222',
			'file:///Users/me/code/default': '__default__profile__',
			'file:///Users/me/code/agents': 'builtin/agents',
			'file:///Users/me/code/shared': '-7d116c72',
			'file:///Users/me/code/ghost': '-deadbeef',
			'file:///Users/me/code/evil': '../../etc',
		},
	},
	userDataProfiles: [
		{ location: '-3fe01222', name: 'Work' },
		{ location: '-7d116c72', name: 'Shared', useDefaultFlags: { extensions: true } },
		{ location: 'builtin/agents', name: 'Agents' },
	],
};

describe('resolveProfile', () => {
	it('uses the profile a workspace is associated with', () => {
		const p = resolveProfile(storage, 'file:///Users/me/code/api', UD, EXT);
		expect(p.key).toBe('-3fe01222');
		expect(p.extensionsJson).toEqual([`${UD}/User/profiles/-3fe01222/extensions.json`, `${EXT}/extensions.json`]);
		expect(p.stateDb).toBe(`${UD}/User/profiles/-3fe01222/globalStorage/state.vscdb`);
	});

	it('uses the Default profile for the default marker, unknown workspaces and empty windows', () => {
		for (const uri of ['file:///Users/me/code/default', 'file:///Users/me/code/new', undefined]) {
			const p = resolveProfile(storage, uri, UD, EXT);
			expect(p.key).toBe('default');
			expect(p.extensionsJson).toEqual([`${EXT}/extensions.json`]);
			expect(p.stateDb).toBe(`${UD}/User/globalStorage/state.vscdb`);
		}
	});

	it('reads the Default extensions for a profile that shares them', () => {
		const p = resolveProfile(storage, 'file:///Users/me/code/shared', UD, EXT);
		expect(p.key).toBe('-7d116c72');
		expect(p.extensionsJson).toEqual([`${EXT}/extensions.json`]);
	});

	it('falls back for profiles that are unknown or have an unsafe location', () => {
		for (const uri of ['file:///Users/me/code/ghost', 'file:///Users/me/code/evil', 'file:///Users/me/code/agents']) {
			expect(resolveProfile(storage, uri, UD, EXT).key).toBe('default');
		}
	});

	it('survives a missing or malformed storage.json', () => {
		for (const bad of [undefined, null, 'x', [], {}, { profileAssociations: 3 }]) {
			expect(resolveProfile(bad, 'file:///Users/me/code/api', UD, EXT).key).toBe('default');
		}
	});
});
