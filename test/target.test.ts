import { describe, expect, it } from 'vitest';
import { normalizeRepoUrl } from '../src/core/repoUrl';
import { resolveTarget, tildify, type GitInfo } from '../src/core/target';

describe('normalizeRepoUrl', () => {
	it.each([
		'git@github.com:Acme/API.git',
		'https://github.com/acme/api.git',
		'https://user:token@github.com/acme/api',
		'ssh://git@github.com:22/acme/api.git',
		'https://GitHub.com/Acme/Api/',
	])('maps %s to one canonical form', url => {
		expect(normalizeRepoUrl(url)).toBe('github.com/acme/api');
	});

	it('keeps nested group paths', () => {
		expect(normalizeRepoUrl('git@gitlab.com:group/sub/proj.git')).toBe('gitlab.com/group/sub/proj');
	});

	it('does not mistake a Windows path for scp syntax', () => {
		expect(normalizeRepoUrl('C:\\repos\\api')).toBe('c:\\repos\\api');
	});
});

describe('tildify', () => {
	it('replaces the home directory', () => {
		expect(tildify('/Users/me/code/x', '/Users/me')).toBe('~/code/x');
		expect(tildify('/Users/mex/code', '/Users/me')).toBe('/Users/mex/code');
	});
});

const env = (over: { workspaceFile?: string; folders?: string[]; git?: GitInfo }) => ({
	workspaceFile: over.workspaceFile,
	folders: over.folders ?? [],
	home: '/Users/me',
	git: async () => over.git,
});

describe('resolveTarget', () => {
	it('prefers the workspace file over everything', async () => {
		const t = await resolveTarget(env({
			workspaceFile: '/Users/me/work/web.code-workspace',
			folders: ['/Users/me/work/web'],
			git: { root: '/Users/me/work/web', originUrl: 'git@github.com:acme/web.git' },
		}));
		expect(t).toEqual({ kind: 'workspace', key: 'workspace:~/work/web.code-workspace', label: 'web' });
	});

	it('uses the origin URL for a repository, from any subfolder', async () => {
		const t = await resolveTarget(env({
			folders: ['/Users/me/code/api/services/x'],
			git: { root: '/Users/me/code/api', originUrl: 'https://github.com/Acme/api.git' },
		}));
		expect(t).toEqual({ kind: 'repo', key: 'repo:github.com/acme/api', label: 'acme/api' });
	});

	it('falls back to the repository root when there is no remote', async () => {
		const t = await resolveTarget(env({ folders: ['/Users/me/code/api/sub'], git: { root: '/Users/me/code/api' } }));
		expect(t).toEqual({ kind: 'repo', key: 'repo:~/code/api', label: 'api' });
	});

	it('falls back to the folder outside any repository', async () => {
		const t = await resolveTarget(env({ folders: ['/Users/me/scratch/foo'] }));
		expect(t).toEqual({ kind: 'folder', key: 'folder:~/scratch/foo', label: 'foo' });
	});

	it('has no Target for empty windows or unsaved multi-root workspaces', async () => {
		expect(await resolveTarget(env({}))).toBeUndefined();
		expect(await resolveTarget(env({ folders: ['/a', '/b'] }))).toBeUndefined();
	});
});
