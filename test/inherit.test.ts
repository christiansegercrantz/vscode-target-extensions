import { describe, expect, it } from 'vitest';
import { findRules, inheritedRules, parseConfig } from '../src/core/config';
import { planTarget } from '../src/core/plan';
import { keysOf, parentPath, resolveTarget, setupTarget, type GitInfo, type Target } from '../src/core/target';

const env = (folder: string, git?: GitInfo) => ({ folders: [folder], home: '/Users/me', git: async () => git });
const chain = (t: Target | undefined): string[] => (t ? [t.key, ...t.parents.map(p => p.key)] : []);
const own = (t: Target | undefined) => t && { kind: t.kind, key: t.key, label: t.label, aliases: t.aliases };

describe('parent Targets', () => {
	it('gives a repository subfolder its own key, with intermediate subfolders, the repository and folders above as parents', async () => {
		const t = await resolveTarget(env('/Users/me/code/api/Services/x', { root: '/Users/me/code/api', originUrl: 'https://github.com/Acme/api.git', prefix: 'Services/x/' }));
		expect(own(t)).toEqual({
			kind: 'subfolder',
			key: 'repo:github.com/acme/api#services/x',
			label: 'x',
			aliases: ['repo:~/code/api#services/x', 'folder:~/code/api/Services/x'],
		});
		expect(chain(t)).toEqual([
			'repo:github.com/acme/api#services/x',
			'repo:github.com/acme/api#services',
			'repo:github.com/acme/api',
			'folder:~/code',
			'folder:~',
			'folder:/Users',
			'folder:/',
		]);
		expect(setupTarget(t!).key).toBe('repo:github.com/acme/api');
	});

	it('derives the subfolder from the paths when git gives no prefix', async () => {
		const t = await resolveTarget(env('/Users/me/code/api/sub', { root: '/Users/me/code/api' }));
		expect(own(t)).toEqual({ kind: 'subfolder', key: 'repo:~/code/api#sub', label: 'sub', aliases: ['folder:~/code/api/sub'] });
		expect(own(t!.parents[0])).toEqual({ kind: 'repo', key: 'repo:~/code/api', label: 'api', aliases: ['folder:~/code/api'] });
	});

	it('keeps the opened path form when git reports a resolved root', async () => {
		const t = await resolveTarget(env('/var/x/api/sub', { root: '/private/var/x/api', prefix: 'sub/' }));
		expect(chain(t)).toEqual(['repo:/private/var/x/api#sub', 'repo:/private/var/x/api', 'folder:/var/x', 'folder:/var', 'folder:/']);
		expect(t!.parents[0]!.aliases).toEqual(['folder:/var/x/api']);
	});

	it('gives a folder every folder above it as parents, each with its own chain', async () => {
		const t = await resolveTarget(env('/Users/me/scratch/foo'));
		expect(chain(t)).toEqual(['folder:~/scratch/foo', 'folder:~/scratch', 'folder:~', 'folder:/Users', 'folder:/']);
		expect(chain(t!.parents[0])).toEqual(chain(t).slice(1));
		expect(setupTarget(t!)).toBe(t);
	});

	it('walks Windows paths up to the drive', async () => {
		const t = await resolveTarget({ folders: ['C:\\work\\foo'], home: 'C:\\Users\\me', git: async () => undefined });
		expect(chain(t)).toEqual(['folder:C:/work/foo', 'folder:C:/work', 'folder:C:/']);
	});

	it('gives a workspace file no parents', async () => {
		const t = await resolveTarget({ workspaceFile: '/Users/me/w.code-workspace', folders: [], home: '/Users/me', git: async () => undefined });
		expect(t?.parents).toEqual([]);
	});
});

describe('parentPath', () => {
	it.each([
		['/Users/me', '/Users'],
		['/Users', '/'],
		['/', undefined],
		['C:\\a', 'C:\\'],
		['C:\\', undefined],
		['ssh-remote+h/home', 'ssh-remote+h'],
		['ssh-remote+h', undefined],
	])('%s -> %s', (path, parent) => {
		expect(parentPath(path)).toBe(parent);
	});
});

describe('findRules', () => {
	const rules = { categories: ['python'], enable: [], disable: [] };
	const config = (targets: Record<string, unknown>) => parseConfig({ python: ['ms-python.python'] }, targets);
	const repoSub = async () => (await resolveTarget(env('/Users/me/code/api/packages/web', { root: '/Users/me/code/api', originUrl: 'git@github.com:acme/api.git', prefix: 'packages/web' })))!;

	it('inherits from a configured folder above a folder', async () => {
		const t = (await resolveTarget(env('/Users/me/scratch/foo/bar')))!;
		const found = findRules(config({ 'folder:~/scratch/foo': rules }), t);
		expect(found?.owner.key).toBe('folder:~/scratch/foo');
		expect(found?.owner).not.toBe(t);
	});

	it('inherits from a configured folder above a repository', async () => {
		const t = (await resolveTarget(env('/Users/me/work/api', { root: '/Users/me/work/api', originUrl: 'git@github.com:acme/api.git' })))!;
		expect(findRules(config({ 'folder:~/work': rules }), t)?.owner.key).toBe('folder:~/work');
	});

	it('lets a repository subfolder inherit the repository, matched by an older key too', async () => {
		const t = await repoSub();
		expect(findRules(config({ 'repo:github.com/acme/api': rules }), t)?.owner.key).toBe('repo:github.com/acme/api');
		expect(findRules(config({ 'repo:~/code/api': rules }), t)?.key).toBe('repo:~/code/api');
	});

	it('uses the nearest configured entry, whose rules replace the ones above', async () => {
		const found = findRules(config({
			'folder:~': { categories: ['*'] },
			'repo:github.com/acme/api': rules,
			'repo:github.com/acme/api#packages': { categories: [], disable: ['x.y'] },
		}), await repoSub());
		expect(found?.key).toBe('repo:github.com/acme/api#packages');
		expect(found?.config).toEqual({ categories: [], enable: [], disable: ['x.y'] });
	});

	it("prefers the Target's own rules, matched case-insensitively", async () => {
		const t = await repoSub();
		const cfg = config({ 'repo:github.com/acme/api': rules, 'repo:github.com/Acme/api#packages/web': { categories: [] } });
		expect(findRules(cfg, t)?.owner).toBe(t);
		expect(inheritedRules(cfg, t)?.owner.key).toBe('repo:github.com/acme/api');
	});

	it('finds nothing when no Target up the chain has rules', async () => {
		expect(findRules(config({ 'folder:~/elsewhere': rules }), await repoSub())).toBeUndefined();
	});

	it("plans an inheriting Target with its parent's rules", async () => {
		const t = await repoSub();
		const cfg = config({ 'folder:~/code': rules });
		const plan = planTarget(cfg, keysOf(findRules(cfg, t)!.owner), new Map(), 'me.self');
		expect(plan.configured).toBe(true);
		expect([...plan.enable]).toEqual(['ms-python.python']);
	});
});
