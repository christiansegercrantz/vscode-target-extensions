import * as vscode from 'vscode';
import { findTarget, parseConfig, serializeTarget, type Config, type TargetConfig } from '../core/config';

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

/** Replaces one Target's rules, keeping the key it is already stored under. */
export async function saveTarget(config: Config, key: string, target: TargetConfig): Promise<void> {
	const storedKey = findTarget(config, key)?.key ?? key;
	const targets = Object.fromEntries(Object.entries(config.targets).map(([k, v]) => [k, serializeTarget(v)]));
	targets[storedKey] = serializeTarget(target);
	await settings().update('targets', targets, vscode.ConfigurationTarget.Global);
}

/** Drops ids from every category and Target; used by "Remove from config". */
export async function removeIds(config: Config, ids: Set<string>): Promise<void> {
	const keep = (list: string[]) => list.filter(id => !ids.has(id));
	await saveCategories(Object.fromEntries(Object.entries(config.categories).map(([n, m]) => [n, keep(m)])));
	const targets = Object.fromEntries(Object.entries(config.targets).map(([k, t]) => [k, serializeTarget({ ...t, enable: keep(t.enable), disable: keep(t.disable) })]));
	await settings().update('targets', targets, vscode.ConfigurationTarget.Global);
}
