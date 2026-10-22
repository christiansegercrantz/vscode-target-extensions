import { expect, it, vi } from 'vitest';
import { gitInfoFromFiles } from '../src/core/gitFiles';
import { currentTarget } from '../src/vscode/target';

const files: Record<string, string> = {};

vi.mock('vscode', () => {
	const uri = (authority: string, path: string): unknown => ({
		scheme: 'vscode-remote',
		authority,
		path,
		with: ({ path: next }: { path: string }) => uri(authority, next),
	});
	return {
		workspace: {
			workspaceFolders: [{ uri: uri('ssh-remote+securo', '/home/bazzite/securo/src') }],
			fs: {
				readFile: async (u: { path: string }) => {
					if (!(u.path in files)) {
						throw new Error('ENOENT');
					}
					return new TextEncoder().encode(files[u.path]);
				},
			},
		},
	};
});

const read = (tree: Record<string, string>) => async (path: string) => tree[path];

it('gives an SSH window the same repo Target as a local clone of the repository', async () => {
	files['/home/bazzite/securo/.git/config'] = '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:acme/securo.git\n';

	const target = await currentTarget();

	expect(target?.key).toBe('repo:github.com/acme/securo');
	expect(target?.aliases).toEqual(['repo:ssh-remote+securo/home/bazzite/securo', 'folder:ssh-remote+securo/home/bazzite/securo/src']);
});

it('reads a linked worktree through its .git file and commondir', async () => {
	const info = await gitInfoFromFiles('/w/feature', read({
		'/w/feature/.git': 'gitdir: ../main/.git/worktrees/feature\n',
		'/w/main/.git/worktrees/feature/commondir': '../..\n',
		'/w/main/.git/config': '[remote "upstream"]\n\turl = https://x/y\n[remote "origin"]\n\turl = https://github.com/acme/api\n',
	}));

	expect(info).toEqual({ root: '/w/feature', originUrl: 'https://github.com/acme/api' });
});

it('finds no repository outside git', async () => {
	expect(await gitInfoFromFiles('/tmp/x', read({}))).toBeUndefined();
});
