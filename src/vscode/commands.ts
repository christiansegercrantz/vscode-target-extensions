import { join } from 'node:path';
import * as vscode from 'vscode';
import { ALL_CATEGORY, categoriesOf, inheritedRules, setMembership, type Config, type TargetConfig } from '../core/config';
import { planTarget } from '../core/plan';
import { keysOf, setupTarget, type Target } from '../core/target';
import type { Controller, State } from './controller';
import { resolveHost } from './inventory';
import { deleteTarget, saveCategories, saveTarget } from './settings';

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

/**
 * Which Target's rules to edit, and the rules to start from. A window that inherits asks whether to edit the parent
 * or to give itself its own rules, starting from the parent's; `customize` skips the question. A Target with no
 * rules anywhere edits its setup Target, the Repository for a subfolder of one.
 */
async function editTarget({ target, rules }: State & { target: Target }, customize = false): Promise<{ target: Target; current?: TargetConfig } | undefined> {
	if (!rules) {
		return { target: setupTarget(target) };
	}
	if (rules.owner === target) {
		return { target, current: rules.config };
	}
	if (customize) {
		return { target, current: rules.config };
	}
	const choice = await vscode.window.showQuickPick(
		[
			{ label: `$(arrow-up) Edit parent "${rules.owner.label}"`, description: 'also changes every folder that inherits from it', owner: rules.owner },
			{ label: `$(edit) Customize ${target.label}`, description: `own rules, starting from ${rules.owner.label}'s`, owner: target },
		],
		{ title: `${target.label} uses ${rules.owner.label}'s rules` },
	);
	return choice && { target: choice.owner, current: rules.config };
}

async function chooseCategories(controller: Controller, customize = false): Promise<void> {
	const state = await requireTarget(controller);
	if (!state) {
		return;
	}
	const { config } = state;
	const names = Object.keys(config.categories);
	if (!names.length) {
		const choice = await vscode.window.showInformationMessage('There are no categories yet.', 'Create category…');
		if (choice) {
			await editCategories(controller);
		}
		return;
	}
	const edit = await editTarget(state, customize);
	if (!edit) {
		return;
	}
	const { target, current } = edit;
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
	await saveTarget(config, target, { categories, enable: current?.enable ?? [], disable: current?.disable ?? [] });
	await controller.setActivated(true);
	await controller.schedule();
}

async function overrideExtensions(controller: Controller): Promise<void> {
	const state = await requireTarget(controller);
	if (!state) {
		return;
	}
	const { config, installed, plan } = state;
	const edit = await editTarget(state);
	if (!edit) {
		return;
	}
	const { target } = edit;
	const current: TargetConfig = edit.current ?? { categories: [], enable: [], disable: [] };

	// What the categories alone would do, so only the differences are stored as overrides.
	const base: Config = { ...config, targets: { ...config.targets, [target.key]: { ...current, enable: [], disable: [] } } };
	const derived = planTarget(base, keysOf(target), installed, controller.selfId);
	// Dependencies don't count: they are only on while something else needs them, so a checked one needs its own override.
	const derivedOn = (id: string) => !derived.managed.has(id) || derived.direct.has(id);
	const effectiveOn = (id: string) => (plan.managed.has(id) ? plan.enable.has(id) : !plan.disable.has(id));

	const universe = pickable(state, controller.selfId).filter(e => !plan.protected.has(e.id));
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
	await saveTarget(config, target, next);

	const after = planTarget({ ...config, targets: { ...config.targets, [target.key]: next } }, keysOf(target), installed, controller.selfId);
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

/** The extension id from an `extension/context` menu click, which passes `(id, { id, version, ... })`. */
function idFromMenuArg(arg: unknown): string | undefined {
	const id = typeof arg === 'string' ? arg : (arg as { id?: unknown } | undefined)?.id;
	return typeof id === 'string' ? id.toLowerCase() : undefined;
}

async function setExtensionCategories(controller: Controller, arg: unknown): Promise<void> {
	const state = await controller.gather();
	let id = idFromMenuArg(arg);
	if (!id) {
		const picked = await vscode.window.showQuickPick(
			pickable(state, controller.selfId).map(e => ({ label: e.displayName, description: e.id, id: e.id })).sort(byName),
			{ matchOnDescription: true, title: 'Set categories for which extension?' },
		);
		id = picked?.id;
	}
	if (!id) {
		return;
	}
	if (id === controller.selfId) {
		void vscode.window.showInformationMessage('Target Extensions never manages itself.');
		return;
	}

	const { config } = state;
	const name = state.installed.get(id)?.displayName ?? id;
	const NEW = '$(add) New category…';
	const current = new Set(categoriesOf(config, id));
	const picked = await vscode.window.showQuickPick(
		[
			...Object.keys(config.categories).sort().map(c => ({ label: c, description: `${config.categories[c]!.length} extension(s)`, picked: current.has(c) })),
			{ label: NEW, description: '' },
		],
		{
			canPickMany: true,
			title: `Categories for ${name}`,
			placeHolder: current.size ? 'Uncheck all to stop managing it' : 'Check categories to manage it: it is then off except where they are chosen',
		},
	);
	if (!picked) {
		return;
	}
	const names = picked.filter(p => p.label !== NEW).map(p => p.label);
	if (picked.some(p => p.label === NEW)) {
		const typed = await vscode.window.showInputBox({
			title: 'New category',
			prompt: 'Name, e.g. python or node',
			validateInput: value => {
				const v = value.trim();
				return !v || v === ALL_CATEGORY ? 'Enter a name' : config.categories[v] ? 'That category already exists; check it in the list instead' : undefined;
			},
		});
		if (!typed) {
			return;
		}
		names.push(typed.trim());
	}
	await saveCategories(setMembership(config.categories, id, names));
	void vscode.window.showInformationMessage(
		names.length
			? `${name} is managed: off everywhere except Targets that use ${names.map(n => `"${n}"`).join(' or ')}.`
			: `${name} is no longer managed and will be turned back on.`,
	);
	await controller.schedule();
}

/** The settings are application-scoped: VS Code keeps them in the Default profile's settings.json for every profile. */
async function openConfigFile(context: vscode.ExtensionContext): Promise<void> {
	const host = await resolveHost(context);
	if (!host) {
		await vscode.commands.executeCommand('workbench.action.openSettings', 'targetExtensions');
		return;
	}
	const file = vscode.Uri.file(join(host.userDataDir, 'User', 'settings.json'));
	await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
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

/** Deletes this Target's own rules so it inherits again, after saying exactly what is removed. */
async function useParentRules(controller: Controller): Promise<void> {
	const state = await requireTarget(controller);
	if (!state) {
		return;
	}
	const { config, target, rules } = state;
	if (rules?.owner !== target) {
		void vscode.window.showInformationMessage(`${target.label} has no rules of its own to delete.`);
		return;
	}
	const parent = inheritedRules(config, target);
	if (!parent) {
		void vscode.window.showInformationMessage(`No folder above ${target.label} has rules to inherit.`);
		return;
	}
	const own = new Set(keysOf(target).map(k => k.toLowerCase()));
	const removed = Object.keys(config.targets).filter(k => own.has(k.toLowerCase()));
	const choice = await vscode.window.showWarningMessage(
		`Delete ${target.label}'s own rules and use ${parent.owner.label}'s instead?`,
		{ modal: true, detail: `This removes ${removed.map(k => `"${k}"`).join(', ')} from your settings.` },
		'Delete and Inherit',
	);
	if (choice === 'Delete and Inherit') {
		await deleteTarget(config, target);
		await controller.schedule();
	}
}

async function menu(controller: Controller): Promise<void> {
	const { config, target, rules } = await controller.gather();
	const canInherit = !!target && rules?.owner === target && !!inheritedRules(config, target);
	const entries: { label: string; description?: string; command: string }[] = [
		{ label: '$(checklist) Choose categories for this Target…', command: 'targetExtensions.chooseCategories' },
		{ label: '$(list-selection) Override extensions for this Target…', command: 'targetExtensions.overrideExtensions' },
		...(canInherit ? [{ label: "$(arrow-up) Use parent's rules…", description: "deletes this folder's rules", command: 'targetExtensions.useParentRules' }] : []),
		{ label: '$(symbol-namespace) Edit categories…', command: 'targetExtensions.editCategories' },
		{ label: '$(tag) Set categories for an extension…', command: 'targetExtensions.setExtensionCategories' },
		{ label: '$(sync) Apply now', command: 'targetExtensions.apply' },
		{ label: '$(discard) Restore all extensions', command: 'targetExtensions.restoreAll' },
		{ label: '$(json) Open config file (settings.json)', command: 'targetExtensions.openConfig' },
		{ label: '$(settings-gear) Open settings', command: 'workbench.action.openSettings' },
	];
	const choice = await vscode.window.showQuickPick(entries, { title: 'Target Extensions' });
	if (choice) {
		await vscode.commands.executeCommand(choice.command, choice.command === 'workbench.action.openSettings' ? 'targetExtensions' : undefined);
	}
}

export function registerCommands(context: vscode.ExtensionContext, controller: Controller): void {
	const register = (id: string, fn: (...args: unknown[]) => Promise<unknown>) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
	register('targetExtensions.menu', () => menu(controller));
	register('targetExtensions.chooseCategories', () => chooseCategories(controller));
	register('targetExtensions.customize', () => chooseCategories(controller, true));
	register('targetExtensions.useParentRules', () => useParentRules(controller));
	register('targetExtensions.overrideExtensions', () => overrideExtensions(controller));
	register('targetExtensions.editCategories', () => editCategories(controller));
	register('targetExtensions.apply', () => controller.schedule());
	register('targetExtensions.restoreAll', () => restoreAll(controller));
	register('targetExtensions.openConfig', () => openConfigFile(context));
	register('targetExtensions.setExtensionCategories', (...args) => setExtensionCategories(controller, args[0]));
}
