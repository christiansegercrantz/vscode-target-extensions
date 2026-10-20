import * as vscode from 'vscode';
import { ALL_CATEGORY, findTarget, type Config, type TargetConfig } from '../core/config';
import { planTarget } from '../core/plan';
import type { Controller, State } from './controller';
import { saveCategories, saveTarget } from './settings';

const NO_TARGET = 'Open a folder or a saved workspace first: this window has no Target.';

const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);

function pickable(state: State, selfId: string) {
	return [...state.installed.values()].filter(e => !e.isBuiltin && e.id !== selfId);
}

async function requireTarget(controller: Controller): Promise<(State & { target: NonNullable<State['target']> }) | undefined> {
	const state = await controller.gather();
	if (!state.target) {
		void vscode.window.showInformationMessage(NO_TARGET);
		return undefined;
	}
	return state as State & { target: NonNullable<State['target']> };
}

async function chooseCategories(controller: Controller): Promise<void> {
	const state = await requireTarget(controller);
	if (!state) {
		return;
	}
	const { config, target } = state;
	const names = Object.keys(config.categories);
	if (!names.length) {
		const choice = await vscode.window.showInformationMessage('There are no categories yet.', 'Create category…');
		if (choice) {
			await editCategories(controller);
		}
		return;
	}
	const current = findTarget(config, target.key)?.config;
	const picked = await vscode.window.showQuickPick(
		[
			{ label: '$(star) All managed extensions', description: ALL_CATEGORY, category: ALL_CATEGORY, picked: !!current?.categories.includes(ALL_CATEGORY) },
			...names.map(name => ({
				label: name,
				description: `${config.categories[name]!.length} extension(s)`,
				category: name,
				picked: !!current?.categories.includes(name),
			})),
		],
		{ canPickMany: true, title: `Categories for ${target.label}`, placeHolder: 'Extensions in the checked categories stay on here' },
	);
	if (!picked) {
		return;
	}
	const categories = picked.some(p => p.category === ALL_CATEGORY) ? [ALL_CATEGORY] : picked.map(p => p.category);
	await saveTarget(config, target.key, { categories, enable: current?.enable ?? [], disable: current?.disable ?? [] });
	await controller.setActivated(true);
	await controller.schedule();
}

async function overrideExtensions(controller: Controller): Promise<void> {
	const state = await requireTarget(controller);
	if (!state) {
		return;
	}
	const { config, target, installed, plan } = state;
	const current: TargetConfig = findTarget(config, target.key)?.config ?? { categories: [], enable: [], disable: [] };

	// What the categories alone would do, so only the differences are stored as overrides.
	const base: Config = { ...config, targets: { ...config.targets, [target.key]: { ...current, enable: [], disable: [] } } };
	const derived = planTarget(base, target.key, installed, controller.selfId);
	// Dependencies don't count: they are only on while something else needs them, so a checked one needs its own override.
	const derivedOn = (id: string) => !derived.managed.has(id) || derived.direct.has(id);
	const effectiveOn = (id: string) => (plan.managed.has(id) ? plan.enable.has(id) : !plan.disable.has(id));

	const universe = pickable(state, controller.selfId);
	const picked = await vscode.window.showQuickPick(
		universe
			.map(e => ({
				label: e.displayName,
				description: e.id,
				detail: plan.managed.has(e.id) ? 'Managed: off unless enabled here' : 'Always on unless disabled here',
				picked: effectiveOn(e.id),
				id: e.id,
			}))
			.sort(byName),
		{ canPickMany: true, matchOnDescription: true, title: `Extensions for ${target.label}`, placeHolder: 'Checked extensions are on here' },
	);
	if (!picked) {
		return;
	}
	const on = new Set(picked.map(p => p.id));
	const known = new Set(universe.map(e => e.id));
	const enable = [...current.enable.filter(id => !known.has(id)), ...universe.filter(e => on.has(e.id) && !derivedOn(e.id)).map(e => e.id)];
	const disable = [...current.disable.filter(id => !known.has(id)), ...universe.filter(e => !on.has(e.id) && derivedOn(e.id)).map(e => e.id)];
	const next: TargetConfig = { ...current, enable, disable };
	await saveTarget(config, target.key, next);

	const after = planTarget({ ...config, targets: { ...config.targets, [target.key]: next } }, target.key, installed, controller.selfId);
	if (after.addedDependencies.length) {
		void vscode.window.showWarningMessage(
			`Kept on because other enabled extensions need them: ${after.addedDependencies.map(d => `${d.id} (for ${d.requiredBy})`).join(', ')}`,
		);
	}
	await controller.setActivated(true);
	await controller.schedule();
}

async function editCategories(controller: Controller): Promise<void> {
	const state = await controller.gather();
	const { config } = state;
	const NEW = '$(add) New category…';
	const choice = await vscode.window.showQuickPick(
		[...Object.keys(config.categories).map(name => ({ label: name, description: `${config.categories[name]!.length} extension(s)` })), { label: NEW, description: '' }],
		{ title: 'Edit categories', placeHolder: 'Pick a category to edit' },
	);
	if (!choice) {
		return;
	}
	let name = choice.label;
	if (name === NEW) {
		const typed = await vscode.window.showInputBox({
			title: 'New category',
			prompt: 'Name, e.g. python or node',
			validateInput: value => {
				const v = value.trim();
				return !v || v === ALL_CATEGORY ? 'Enter a name' : config.categories[v] ? 'That category already exists' : undefined;
			},
		});
		if (!typed) {
			return;
		}
		name = typed.trim();
	}

	const members = new Set(config.categories[name] ?? []);
	const universe = pickable(state, controller.selfId);
	const picked = await vscode.window.showQuickPick(
		universe
			.map(e => ({ label: e.displayName, description: e.id, picked: members.has(e.id), id: e.id }))
			.sort(byName),
		{ canPickMany: true, matchOnDescription: true, title: `Extensions in "${name}"`, placeHolder: 'Extensions here are off by default and on only where this category is chosen' },
	);
	if (!picked) {
		return;
	}
	const known = new Set(universe.map(e => e.id));
	// Members that are not installed here stay, so a machine with fewer extensions does not shrink the shared category.
	const kept = [...members].filter(id => !known.has(id));
	const next = [...kept, ...picked.map(p => p.id)];
	const categories = { ...config.categories };
	if (next.length) {
		categories[name] = next;
	} else if (await vscode.window.showWarningMessage(`"${name}" is empty. Delete it?`, { modal: true }, 'Delete') === 'Delete') {
		delete categories[name];
	} else {
		return;
	}
	await saveCategories(categories);
	await controller.schedule();
}

async function restoreAll(controller: Controller): Promise<void> {
	const choice = await vscode.window.showWarningMessage(
		'Restore all extensions? This removes every disable entry Target Extensions added, here and globally, and turns it off on this machine until you activate it again.',
		{ modal: true },
		'Restore',
	);
	if (choice === 'Restore') {
		await controller.restoreAll();
	}
}

async function menu(): Promise<void> {
	const entries: { label: string; command: string }[] = [
		{ label: '$(checklist) Choose categories for this Target…', command: 'targetExtensions.chooseCategories' },
		{ label: '$(list-selection) Override extensions for this Target…', command: 'targetExtensions.overrideExtensions' },
		{ label: '$(symbol-namespace) Edit categories…', command: 'targetExtensions.editCategories' },
		{ label: '$(sync) Apply now', command: 'targetExtensions.apply' },
		{ label: '$(discard) Restore all extensions', command: 'targetExtensions.restoreAll' },
		{ label: '$(settings-gear) Open settings', command: 'workbench.action.openSettings' },
	];
	const choice = await vscode.window.showQuickPick(entries, { title: 'Target Extensions' });
	if (choice) {
		await vscode.commands.executeCommand(choice.command, choice.command === 'workbench.action.openSettings' ? 'targetExtensions' : undefined);
	}
}

export function registerCommands(context: vscode.ExtensionContext, controller: Controller): void {
	const register = (id: string, fn: () => Promise<unknown>) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
	register('targetExtensions.menu', menu);
	register('targetExtensions.chooseCategories', () => chooseCategories(controller));
	register('targetExtensions.overrideExtensions', () => overrideExtensions(controller));
	register('targetExtensions.editCategories', () => editCategories(controller));
	register('targetExtensions.apply', () => controller.schedule());
	register('targetExtensions.restoreAll', () => restoreAll(controller));
}
