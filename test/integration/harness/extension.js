// Test harness for a real VS Code. It runs as a second development extension next to Target Extensions, in a
// normal (not extension-test) window: test mode keeps storage in memory, so nothing would survive a relaunch.
// Each phase is one launch of the same profile; it records its result in a file and quits gracefully so
// VS Code flushes its storage, as a reload does.
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
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
	// A fresh profile gets VS Code's own first-run writes to the same lists; let them settle before the real phases.
	async phase0() {
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
