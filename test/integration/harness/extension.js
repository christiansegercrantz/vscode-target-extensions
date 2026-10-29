// Test harness for a real VS Code. It runs as a second development extension next to Target Extensions, in a
// normal (not extension-test) window: test mode keeps storage in memory, so nothing would survive a relaunch.
// Each phase is one launch of the same profile; it records its result in a file and quits gracefully so
// VS Code flushes its storage, as a reload does.
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const vscode = require('vscode');

const SELF = 'csegercrantz.target-extensions';
const MANAGED = ['vscode.markdown-language-features', 'vscode.php-language-features', 'vscode.npm', 'vscode.media-preview'];
const TARGET = 'repo:example.com/acme/demo';

const present = id => vscode.extensions.all.some(e => e.id.toLowerCase() === id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ids = list => list.map(e => e.id.toLowerCase());
const ours = list => ids(list).filter(id => MANAGED.includes(id)).sort();

async function setConfig(targetCategories) {
	const cfg = vscode.workspace.getConfiguration('targetExtensions');
	await cfg.update('categories', { demo: MANAGED }, vscode.ConfigurationTarget.Global);
	await cfg.update('targets', { [TARGET]: { categories: targetCategories } }, vscode.ConfigurationTarget.Global);
}

const phases = {
	// Not an assertion: writes what the pickers would offer, for comparing with a real profile.
	async dump({ controller }) {
		const state = await controller.gather();
		const all = [...state.installed.values()].map(e => ({ id: e.id, builtin: e.isBuiltin }));
		writeFileSync(join(process.env.TE_RESULT_DIR, 'inventory.json'), JSON.stringify(all));
	},

	// A fresh profile gets VS Code's own first-run writes to the same lists; let them settle before the real phases.
	async phase0() {
		await sleep(3000);
	},

	// Creates the named profile and associates the workspace with it.
	async profile0() {
		await sleep(3000);
	},

	async phase1({ controller, store }) {
		for (const id of MANAGED) {
			assert.ok(present(id), `${id} should exist as a built-in extension`);
		}
		await setConfig([]);
		await controller.setActivated(true);
		await controller.schedule();
		const lists = await store.read();
		assert.deepEqual(ours(lists.globalDisabled), [...MANAGED].sort(), 'managed extensions are disabled globally');
		assert.deepEqual(lists.workspaceEnabled, [], 'nothing is enabled in this workspace yet');
	},

	async phase2({ controller, store }) {
		for (const id of MANAGED) {
			assert.ok(!present(id), `${id} should be off after the reload`);
		}
		const state = await controller.gather();
		assert.equal(state.target.key, TARGET, 'target resolves from the git origin');
		assert.equal(state.activated, true);
		await setConfig(['demo']);
		await controller.schedule();
		const lists = await store.read();
		assert.deepEqual(ours(lists.workspaceEnabled), [...MANAGED].sort(), 'category members are enabled in this workspace');
	},

	async phase3({ controller, store }) {
		for (const id of MANAGED) {
			assert.ok(present(id), `${id} should be on again: workspace enable beats global disable`);
		}
		const before = await store.read();
		assert.deepEqual(ours(before.globalDisabled), [...MANAGED].sort(), 'still disabled globally');
		await controller.restoreAll();
		const lists = await store.read();
		assert.deepEqual(ours(lists.globalDisabled), [], 'restore removes our global entries');
		assert.deepEqual(lists.workspaceEnabled, [], 'restore removes our workspace entries');
		assert.equal(controller.isActivated(), false);
	},

	// Runs in a non-default profile. The extensions offered must come from that profile's own list, and the
	// uninstall mirror must point at its own state database.
	async profile({ controller }) {
		const state = await controller.gather();
		assert.ok(!vscode.extensions.getExtension('fake.profileonly'), 'precondition: the extension is not running, so only the file can reveal it');
		assert.ok(state.installed.has('fake.profileonly'), "the profile's own extension list is read");
		assert.ok(state.installed.has('vscode.markdown-language-features'), 'built-in extensions are still offered');
		await setConfig([]);
		await controller.setActivated(true);
		await controller.schedule();
		const dir = join(process.env.TE_USER_DATA, 'User', 'globalStorage', SELF);
		const files = readdirSync(dir).filter(f => /^owned\..+\.json$/.test(f) && f !== 'owned.default.json');
		assert.equal(files.length, 1, `a mirror keyed by this profile next to the Default one, found ${files}`);
		const mirror = JSON.parse(readFileSync(join(dir, files[0]), 'utf8'));
		assert.ok(mirror.dbPath.includes(`${join('User', 'profiles')}`), `mirror points at the profile database: ${mirror.dbPath}`);
		assert.ok(mirror.ids.length > 0, 'the mirror lists what was disabled');
		const defaultMirror = JSON.parse(readFileSync(join(dir, 'owned.default.json'), 'utf8'));
		assert.ok(!defaultMirror.dbPath.includes(`${join('User', 'profiles')}`), 'the Default mirror still points at the Default database');
	},

	// Default profile counterpart of the check above.
	async defaultProfile({ controller }) {
		const state = await controller.gather();
		assert.ok(state.installed.has('fake.defaultonly'), 'the Default profile offers its own extension');
	},

	// Rules saved before the repository had a remote (so under its folder key) must still apply, and move to
	// the repository key when saved again.
	async alias({ controller, settings }) {
		const oldKey = `folder:${vscode.workspace.workspaceFolders[0].uri.fsPath}`;
		const cfg = vscode.workspace.getConfiguration('targetExtensions');
		await cfg.update('categories', { demo: MANAGED }, vscode.ConfigurationTarget.Global);
		await cfg.update('targets', { [oldKey]: { categories: ['demo'] } }, vscode.ConfigurationTarget.Global);
		const state = await controller.gather();
		assert.equal(state.target.key, TARGET, 'the window now resolves to its origin key');
		assert.ok(state.plan.configured, 'rules saved under the old folder key still apply');
		assert.deepEqual(ours([...state.plan.enable].map(id => ({ id }))), [...MANAGED].sort(), 'the old rules enable their categories');

		await settings.saveTarget(settings.readConfig(), state.target, { categories: ['demo'], enable: [], disable: [] });
		const keys = Object.keys(vscode.workspace.getConfiguration('targetExtensions').get('targets'));
		assert.deepEqual(keys, [TARGET], `the rules moved to the origin key, found ${keys}`);
	},

	// A repository with no rules of its own uses those of the folder above it, until it gets its own, and goes back
	// to them when its own are deleted.
	async inherit({ controller, settings }) {
		const parentKey = `folder:${dirname(vscode.workspace.workspaceFolders[0].uri.fsPath)}`;
		const cfg = vscode.workspace.getConfiguration('targetExtensions');
		await cfg.update('categories', { demo: MANAGED }, vscode.ConfigurationTarget.Global);
		await cfg.update('targets', { [parentKey]: { categories: ['demo'] } }, vscode.ConfigurationTarget.Global);
		let state = await controller.gather();
		assert.equal(state.target.key, TARGET);
		assert.equal(state.rules.owner.key, parentKey, 'the rules come from the folder above the repository');
		assert.ok(state.plan.configured, 'an inheriting Target counts as configured');
		assert.deepEqual(ours([...state.plan.enable].map(id => ({ id }))), [...MANAGED].sort(), "the parent's categories apply");

		await settings.saveTarget(settings.readConfig(), state.target, { categories: [], enable: [], disable: [] });
		state = await controller.gather();
		assert.equal(state.rules.owner, state.target, 'own rules replace the inherited ones');
		assert.deepEqual([...state.plan.enable], [], 'nothing from the parent leaks into own rules');

		await settings.deleteTarget(settings.readConfig(), state.target);
		state = await controller.gather();
		assert.equal(state.rules.owner.key, parentKey, 'deleting own rules inherits again');
		assert.deepEqual(Object.keys(vscode.workspace.getConfiguration('targetExtensions').get('targets')), [parentKey], 'only the parent entry is left');
	},

	async phase4() {
		for (const id of MANAGED) {
			assert.ok(present(id), `${id} should be on after restore`);
		}
	},
};

exports.activate = async function activate() {
	const phase = process.env.TE_PHASE;
	const result = join(process.env.TE_RESULT_DIR, `${phase}.json`);
	try {
		assert.ok(phases[phase], `unknown phase ${phase}`);
		const extension = vscode.extensions.getExtension(SELF);
		assert.ok(extension, 'Target Extensions is loaded');
		const api = await extension.activate();
		assert.ok(api && api.controller && api.store, "the storage channel is available in this VS Code");
		await sleep(500);
		await phases[phase](api);
		writeFileSync(result, JSON.stringify({ ok: true }));
	} catch (error) {
		writeFileSync(result, JSON.stringify({ ok: false, error: String(error && error.stack ? error.stack : error) }));
	}
	await vscode.commands.executeCommand('workbench.action.quit');
};
