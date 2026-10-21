import { describe, expect, it } from 'vitest';
import { categoriesOf, findTarget, managedExtensions, parseConfig, referencesSelf, serializeTarget, setMembership } from '../src/core/config';
import { planTarget, type InstalledInfo } from '../src/core/plan';
import { keysOf } from '../src/core/target';

const SELF = 'me.target-extensions';

const installed = (spec: Record<string, string[]>): Map<string, InstalledInfo> =>
	new Map(Object.entries(spec).map(([id, dependencies]) => [id, { id, dependencies }]));

const config = parseConfig(
	{
		python: ['ms-python.python', 'ms-python.vscode-pylance', 'ms-python.mypy'],
		node: ['dbaeumer.vscode-eslint', 'esbenp.prettier-vscode'],
	},
	{
		'repo:github.com/acme/api': { categories: ['python'], disable: ['ms-python.mypy'], enable: ['esbenp.prettier-vscode'] },
		'folder:~/scratch/all': { categories: ['*'] },
		'folder:~/Scratch/Mixed': { categories: ['node'], disable: ['eamodio.gitlens'] },
	},
);

const all = installed({
	'ms-python.python': [],
	'ms-python.vscode-pylance': ['ms-python.python'],
	'ms-python.mypy': [],
	'dbaeumer.vscode-eslint': [],
	'esbenp.prettier-vscode': [],
	'eamodio.gitlens': [],
});

describe('parseConfig', () => {
	it('cleans ids and drops malformed entries', () => {
		const c = parseConfig({ A: [' Pub.Ext ', 'pub.ext', 3, ''], '*': ['x.y'], B: 'nope' }, { k: { categories: ['A', 7], enable: ['X.Y'] }, bad: 'nope' });
		expect(c.categories).toEqual({ A: ['pub.ext'], B: [] });
		expect(c.targets.k).toEqual({ categories: ['A'], enable: ['x.y'], disable: [] });
		expect(c.targets.bad).toEqual({ categories: [], enable: [], disable: [] });
	});

	it('finds targets ignoring case', () => {
		expect(findTarget(config, 'folder:~/scratch/mixed')?.key).toBe('folder:~/Scratch/Mixed');
		expect(findTarget(config, 'folder:~/nope')).toBeUndefined();
	});

	it('omits empty override lists when serializing', () => {
		expect(serializeTarget({ categories: ['a'], enable: [], disable: [] })).toEqual({ categories: ['a'] });
	});
});

describe('managed extensions', () => {
	it('are the union of all categories, never including this extension', () => {
		const c = parseConfig({ a: ['x.y', SELF], b: ['x.y', 'p.q'] }, {});
		expect(managedExtensions(c, SELF)).toEqual(new Set(['x.y', 'p.q']));
		expect(referencesSelf(c, SELF)).toBe(true);
		expect(referencesSelf(config, SELF)).toBe(false);
	});
});

describe('planTarget', () => {
	it('enables nothing for an unconfigured Target', () => {
		const plan = planTarget(config, 'repo:github.com/other/x', all, SELF);
		expect(plan.configured).toBe(false);
		expect(plan.enable.size).toBe(0);
	});

	it('enables category members, applies overrides, and lets disable beat categories', () => {
		const plan = planTarget(config, 'repo:github.com/acme/api', all, SELF);
		expect([...plan.enable].sort()).toEqual(['esbenp.prettier-vscode', 'ms-python.python', 'ms-python.vscode-pylance']);
		expect(plan.disable.size).toBe(0);
	});

	it('enables every managed extension for the * category', () => {
		const plan = planTarget(config, 'folder:~/scratch/all', all, SELF);
		expect(plan.enable).toEqual(plan.managed);
	});

	it('disables unmanaged extensions on request, and ignores enabling them', () => {
		const plan = planTarget(config, 'folder:~/scratch/mixed', all, SELF);
		expect([...plan.disable]).toEqual(['eamodio.gitlens']);
		expect([...plan.enable].sort()).toEqual(['dbaeumer.vscode-eslint', 'esbenp.prettier-vscode']);
	});

	it('pulls in managed dependencies that a category or override left out', () => {
		const c = parseConfig({ py: ['ms-python.python', 'ms-python.vscode-pylance'] }, { 'folder:~/x': { categories: ['py'], disable: ['ms-python.python'] } });
		const plan = planTarget(c, 'folder:~/x', all, SELF);
		expect(plan.enable.has('ms-python.python')).toBe(true);
		expect(plan.addedDependencies).toEqual([{ id: 'ms-python.python', requiredBy: 'ms-python.vscode-pylance' }]);
		expect([...plan.direct]).toEqual(['ms-python.vscode-pylance']);
	});

	it('keeps an unmanaged dependency enabled even when the Target disables it', () => {
		const c = parseConfig({ py: ['ms-python.vscode-pylance'] }, { 'folder:~/x': { categories: ['py'], disable: ['ms-python.python'] } });
		const plan = planTarget(c, 'folder:~/x', all, SELF);
		expect(plan.disable.has('ms-python.python')).toBe(false);
	});

	it('reports referenced extensions that are not installed', () => {
		const plan = planTarget(config, 'repo:github.com/acme/api', installed({ 'ms-python.python': [] }), SELF);
		expect(plan.missing).toEqual(['esbenp.prettier-vscode', 'ms-python.mypy', 'ms-python.vscode-pylance']);
	});

	it('never plans anything for this extension', () => {
		const c = parseConfig({ a: [SELF, 'x.y'] }, { 'folder:~/x': { categories: ['a'], disable: [SELF] } });
		const plan = planTarget(c, 'folder:~/x', installed({ 'x.y': [], [SELF]: [] }), SELF);
		expect([...plan.enable]).toEqual(['x.y']);
		expect(plan.disable.size).toBe(0);
		expect(plan.missing).toEqual([]);
	});

	it.each(['ssh', 'wsl', 'dev-container'])('protects the %s resolver and transitive dependencies, but not ordinary UI extensions', authority => {
		const remote = new Map([
			['remote.resolver', { id: 'remote.resolver', dependencies: ['remote.helper'], activationEvents: [`onResolveRemoteAuthority:${authority}`] }],
			['remote.helper', { id: 'remote.helper', dependencies: ['remote.transitive'], activationEvents: [] }],
			['remote.transitive', { id: 'remote.transitive', dependencies: ['remote.resolver'], activationEvents: [] }],
			['ui.tool', { id: 'ui.tool', dependencies: [], activationEvents: ['onCommand:connect'] }],
		]);
		const ids = [...remote.keys()];
		const c = parseConfig({ remote: ids }, { 'folder:~/x': { categories: ['*'], disable: ids } });
		const plan = planTarget(c, 'folder:~/x', remote, SELF);
		expect(plan.protected).toEqual(new Set(['remote.resolver', 'remote.helper', 'remote.transitive']));
		expect(plan.managed).toEqual(new Set(['ui.tool']));
		expect(plan.disable.size).toBe(0);
		expect(plan.enable.size).toBe(0);
		expect(plan.direct.size).toBe(0);
		expect(plan.missing).toEqual([]);
		expect(c.categories.remote).toEqual(ids);
	});
});

describe('category membership', () => {
	it('lists the categories an extension is in, ignoring case', () => {
		expect(categoriesOf(config, 'MS-Python.Python')).toEqual(['python']);
		expect(categoriesOf(config, 'nobody.here')).toEqual([]);
	});

	it('puts an extension in exactly the named categories, creating new ones', () => {
		const next = setMembership({ a: ['x.y', 'p.q'], b: ['p.q'], c: [] }, 'P.Q', ['b', 'c', 'fresh']);
		expect(next).toEqual({ a: ['x.y'], b: ['p.q'], c: ['p.q'], fresh: ['p.q'] });
	});

	it('does not duplicate a member and leaves other extensions in order', () => {
		expect(setMembership({ a: ['p.q', 'x.y'] }, 'p.q', ['a'])).toEqual({ a: ['x.y', 'p.q'] });
	});

	it('can empty every category, which makes the extension unmanaged', () => {
		const next = setMembership({ a: ['p.q'], b: ['p.q'] }, 'p.q', []);
		expect(next).toEqual({ a: [], b: [] });
		expect(managedExtensions(parseConfig(next, {}), SELF).has('p.q')).toBe(false);
	});
});

describe('rules saved under an earlier Target key', () => {
	const target = { key: 'repo:github.com/acme/new', aliases: ['repo:~/code/new', 'folder:~/code/new'] };
	const rules = (keys: Record<string, string[]>) => parseConfig({ python: ['ms-python.python'] }, Object.fromEntries(Object.entries(keys).map(([k, c]) => [k, { categories: c }])));

	it('still apply after a repository gains a remote', () => {
		const config = rules({ 'repo:~/code/new': ['python'] });
		expect(planTarget(config, target.key, all, SELF).configured).toBe(false);
		const plan = planTarget(config, keysOf(target), all, SELF);
		expect(plan.configured).toBe(true);
		expect([...plan.enable]).toEqual(['ms-python.python']);
	});

	it('still apply after a folder becomes a repository', () => {
		expect(planTarget(rules({ 'folder:~/code/new': ['python'] }), keysOf(target), all, SELF).configured).toBe(true);
	});

	it('prefer the current key over an older one', () => {
		const config = parseConfig({ python: ['ms-python.python'], node: ['dbaeumer.vscode-eslint'] }, { 'repo:~/code/new': { categories: ['python'] }, 'repo:github.com/acme/new': { categories: ['node'] } });
		expect([...planTarget(config, keysOf(target), all, SELF).enable]).toEqual(['dbaeumer.vscode-eslint']);
	});
});
