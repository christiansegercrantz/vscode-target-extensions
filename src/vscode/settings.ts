import * as vscode from 'vscode';
import { parseConfig, serializeTarget, type Config, type TargetConfig } from '../core/config';
import { keysOf, type Target } from '../core/target';

const SECTION = 'targetExtensions';

export function readConfig(): Config {
	const cfg = vscode.workspace.getConfiguration(SECTION);
	return parseConfig(cfg.get('categories'), cfg.get('targets'));
}

function settings() {
	return vscode.workspace.getConfiguration(SECTION);
}

export async function saveCategories(categories: Config['categories']): Promise<void> {
	await settings().update('categories', categories, vscode.ConfigurationTarget.Global);
}

/** Replaces one Target's rules and stores them under its current key, dropping the older keys they were saved under. */
export async function saveTarget(config: Config, target: Target, value: TargetConfig): Promise<void> {
	const targets = withoutTarget(config, target);
	targets[target.key] = serializeTarget(value);
	await settings().update('targets', targets, vscode.ConfigurationTarget.Global);
}

function withoutTarget(config: Config, target: Target): Record<string, Record<string, string[]>> {
	const replaced = new Set(keysOf(target).map(k => k.toLowerCase()));
	return Object.fromEntries(Object.entries(config.targets).filter(([k]) => !replaced.has(k.toLowerCase())).map(([k, v]) => [k, serializeTarget(v)]));
}

/** Removes a Target's own rules, under its current key and every older one, so it inherits again. */
export async function deleteTarget(config: Config, target: Target): Promise<void> {
	await settings().update('targets', withoutTarget(config, target), vscode.ConfigurationTarget.Global);
}

/** Drops ids from every category and Target; used by "Remove from config". */
export async function removeIds(config: Config, ids: Set<string>): Promise<void> {
	const keep = (list: string[]) => list.filter(id => !ids.has(id));
	await saveCategories(Object.fromEntries(Object.entries(config.categories).map(([n, m]) => [n, keep(m)])));
	const targets = Object.fromEntries(Object.entries(config.targets).map(([k, t]) => [k, serializeTarget({ ...t, enable: keep(t.enable), disable: keep(t.disable) })]));
	await settings().update('targets', targets, vscode.ConfigurationTarget.Global);
}
