import { describe, expect, it } from 'vitest';
import { nextList } from '../src/core/lists';
import { parseConfig } from '../src/core/config';
import { planTarget } from '../src/core/plan';
import { emptyOwnership, pendingChanges, reconcile, toLists, type EnablementStore, type RawLists } from '../src/core/reconcile';

class MemoryStore implements EnablementStore {
	writes = 0;
	constructor(public lists: RawLists = { globalDisabled: [], workspaceDisabled: [], workspaceEnabled: [] }) {}
	async read() {
		return structuredClone(this.lists);
	}
	async writeGlobalDisabled(list: RawLists['globalDisabled']) {
		this.writes++;
		this.lists.globalDisabled = list;
	}
	async writeWorkspaceDisabled(list: RawLists['globalDisabled']) {
		this.writes++;
		this.lists.workspaceDisabled = list;
	}
	async writeWorkspaceEnabled(list: RawLists['globalDisabled']) {
		this.writes++;
		this.lists.workspaceEnabled = list;
	}
}

const ids = (l: { id: string }[]) => l.map(e => e.id);

describe('nextList', () => {
	it('keeps the user entries and adds ours', () => {
		const r = nextList([{ id: 'user.one', uuid: 'u' }], [], ['a.b']);
		expect(r.list).toEqual([{ id: 'user.one', uuid: 'u' }, { id: 'a.b' }]);
		expect(r.owned).toEqual(['a.b']);
		expect(r.changed).toBe(true);
	});

	it('removes only owned entries that are no longer wanted', () => {
		const r = nextList([{ id: 'user.one' }, { id: 'a.b' }, { id: 'c.d' }], ['a.b', 'c.d'], ['c.d']);
		expect(ids(r.list)).toEqual(['user.one', 'c.d']);
		expect(r.owned).toEqual(['c.d']);
	});

	it('does not take over an id the user already listed', () => {
		const r = nextList([{ id: 'A.B' }], [], ['a.b']);
		expect(r.owned).toEqual([]);
		expect(r.changed).toBe(false);
	});

	it('reports no change when nothing differs', () => {
		expect(nextList([{ id: 'a.b' }], ['a.b'], ['a.b']).changed).toBe(false);
	});
});

describe('reconcile', () => {
	const installed = new Set(['py.python', 'py.lint', 'js.eslint', 'other.tool']);
	const managed = new Set(['py.python', 'py.lint', 'js.eslint', 'not.installed']);

	it('disables installed managed extensions globally and enables the Target ones here', async () => {
		const store = new MemoryStore();
		const r = await reconcile({ store, owned: emptyOwnership(), managed, installed, workspace: { enable: new Set(['py.python']), disable: new Set(['other.tool']) } });
		expect(ids(store.lists.globalDisabled).sort()).toEqual(['js.eslint', 'py.lint', 'py.python']);
		expect(ids(store.lists.workspaceEnabled)).toEqual(['py.python']);
		expect(ids(store.lists.workspaceDisabled)).toEqual(['other.tool']);
		expect(r.owned.globalDisabled).toEqual(['js.eslint', 'py.lint', 'py.python']);
		expect(r.wroteGlobal).toBe(true);
	});

	it('is idempotent', async () => {
		const store = new MemoryStore();
		const first = await reconcile({ store, owned: emptyOwnership(), managed, installed, workspace: { enable: new Set(['py.python']), disable: new Set() } });
		const writes = store.writes;
		const second = await reconcile({ store, owned: first.owned, managed, installed, workspace: { enable: new Set(['py.python']), disable: new Set() } });
		expect(store.writes).toBe(writes);
		expect(second.wroteGlobal).toBe(false);
	});

	it('restores an extension that leaves every category, but not one the user disabled themselves', async () => {
		const store = new MemoryStore({ globalDisabled: [{ id: 'py.lint' }], workspaceDisabled: [], workspaceEnabled: [] });
		const first = await reconcile({ store, owned: emptyOwnership(), managed, installed });
		expect(first.owned.globalDisabled).toEqual(['js.eslint', 'py.python']);
		const shrunk = await reconcile({ store, owned: first.owned, managed: new Set(['py.lint']), installed });
		expect(ids(store.lists.globalDisabled)).toEqual(['py.lint']);
		expect(shrunk.owned.globalDisabled).toEqual([]);
	});

	it('leaves the workspace lists alone when no workspace wishes are given', async () => {
		const store = new MemoryStore({ globalDisabled: [], workspaceDisabled: [{ id: 'x.y' }], workspaceEnabled: [{ id: 'z.w' }] });
		await reconcile({ store, owned: emptyOwnership(), managed, installed });
		expect(ids(store.lists.workspaceDisabled)).toEqual(['x.y']);
		expect(ids(store.lists.workspaceEnabled)).toEqual(['z.w']);
	});

	it('undoes everything it owns when nothing is managed', async () => {
		const store = new MemoryStore();
		const first = await reconcile({ store, owned: emptyOwnership(), managed, installed, workspace: { enable: new Set(['py.python']), disable: new Set(['other.tool']) } });
		await reconcile({ store, owned: first.owned, managed: new Set(), installed, workspace: { enable: new Set(), disable: new Set() } });
		expect(store.lists).toEqual({ globalDisabled: [], workspaceDisabled: [], workspaceEnabled: [] });
	});

	it.each([undefined, 'folder:~/configured', 'folder:~/new'])('keeps SSH available before connecting from %s', async target => {
		const ssh = 'ms-vscode-remote.remote-ssh';
		const helper = 'remote.helper';
		const installed = new Map([
			[ssh, { id: ssh, dependencies: [helper], activationEvents: ['onResolveRemoteAuthority:ssh'] }],
			[helper, { id: helper, dependencies: [], activationEvents: [] }],
			['py.python', { id: 'py.python', dependencies: [], activationEvents: [] }],
		]);
		const config = parseConfig({ remote: [ssh, helper], python: ['py.python'] }, {
			'folder:~/configured': { categories: [], disable: [ssh, helper] },
		});
		const plan = planTarget(config, target, installed, 'me.target-extensions');
		const store = new MemoryStore({
			globalDisabled: [{ id: ssh }, { id: helper }, { id: 'user.disabled' }],
			workspaceDisabled: [{ id: ssh }, { id: helper }, { id: 'user.disabled' }],
			workspaceEnabled: [],
		});
		const result = await reconcile({
			store,
			owned: { globalDisabled: [ssh, helper], workspaceDisabled: [ssh, helper], workspaceEnabled: [] },
			managed: plan.managed,
			installed: new Set(installed.keys()),
			protected: plan.protected,
			workspace: plan.configured ? { enable: plan.enable, disable: plan.disable } : undefined,
		});
		expect(ids(store.lists.globalDisabled).sort()).toEqual(['py.python', 'user.disabled']);
		expect(ids(store.lists.workspaceDisabled)).toEqual(['user.disabled']);
		expect(result.owned.globalDisabled).toEqual(['py.python']);
		expect(result.owned.workspaceDisabled).toEqual([]);
		expect(pendingChanges(toLists(store.lists), new Set(), [ssh, helper]).enabled).toEqual([ssh, helper].sort());
		const writes = store.writes;
		await reconcile({
			store, owned: result.owned, managed: plan.managed, installed: new Set(installed.keys()), protected: plan.protected,
			workspace: plan.configured ? { enable: plan.enable, disable: plan.disable } : undefined,
		});
		expect(store.writes).toBe(writes);
	});

	it('repairs connection disables without changing unrelated workspace wishes in an unconfigured window', async () => {
		const store = new MemoryStore({
			globalDisabled: [],
			workspaceDisabled: [{ id: 'remote.resolver' }, { id: 'other.tool' }, { id: 'user.disabled' }],
			workspaceEnabled: [{ id: 'py.python' }],
		});
		const result = await reconcile({
			store,
			owned: { globalDisabled: [], workspaceDisabled: ['remote.resolver', 'other.tool', 'user.removed'], workspaceEnabled: ['py.python'] },
			managed: new Set(), installed, protected: new Set(['remote.resolver']),
		});
		expect(ids(store.lists.workspaceDisabled)).toEqual(['user.disabled', 'other.tool']);
		expect(ids(store.lists.workspaceEnabled)).toEqual(['py.python']);
		expect(result.owned.workspaceDisabled).toEqual(['other.tool']);
		expect(result.owned.workspaceEnabled).toEqual(['py.python']);
	});

	it('preserves manual disables of remote connection extensions', async () => {
		const ssh = 'ms-vscode-remote.remote-ssh';
		const store = new MemoryStore({ globalDisabled: [{ id: ssh }], workspaceDisabled: [{ id: ssh }], workspaceEnabled: [] });
		await reconcile({
			store, owned: emptyOwnership(), managed: new Set(), installed: new Set([ssh]), protected: new Set([ssh]),
			workspace: { enable: new Set(), disable: new Set() },
		});
		expect(ids(store.lists.globalDisabled)).toEqual([ssh]);
		expect(ids(store.lists.workspaceDisabled)).toEqual([ssh]);
	});
});

describe('pendingChanges', () => {
	const lists = toLists({ globalDisabled: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], workspaceDisabled: [{ id: 'd' }], workspaceEnabled: [{ id: 'b' }] });

	it('uses VS Code precedence: workspace enable beats workspace disable beats global disable', () => {
		const running = new Set(['a', 'b', 'c', 'd', 'e']);
		expect(pendingChanges(lists, running, ['a', 'b', 'c', 'd', 'e'])).toEqual({ enabled: [], disabled: ['a', 'c', 'd'] });
	});

	it('reports extensions that should run but do not', () => {
		expect(pendingChanges(lists, new Set(), ['a', 'b', 'e'])).toEqual({ enabled: ['b', 'e'], disabled: [] });
	});

	it('has nothing pending once the running state matches, such as after the user toggled it live', () => {
		expect(pendingChanges(lists, new Set(['b', 'e']), ['a', 'b', 'c', 'd', 'e'])).toEqual({ enabled: [], disabled: [] });
	});

	it('ignores extensions outside the universe', () => {
		expect(pendingChanges(lists, new Set(['a']), ['b'])).toEqual({ enabled: ['b'], disabled: [] });
	});
});
