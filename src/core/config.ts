/** Category member meaning "every managed extension". */
export const ALL_CATEGORY = '*';

export interface TargetConfig {
	categories: string[];
	enable: string[];
	disable: string[];
}

export interface Config {
	categories: Record<string, string[]>;
	targets: Record<string, TargetConfig>;
}

function ids(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return [...new Set(value.filter((v): v is string => typeof v === 'string').map(v => v.trim().toLowerCase()).filter(Boolean))];
}

function names(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return [...new Set(value.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean))];
}

function entries(value: unknown): [string, unknown][] {
	return value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
}

/** Cleans raw setting values: ids are trimmed, lower-cased and de-duplicated; malformed entries are dropped. */
export function parseConfig(rawCategories: unknown, rawTargets: unknown): Config {
	const categories: Config['categories'] = {};
	for (const [name, members] of entries(rawCategories)) {
		if (name.trim() && name !== ALL_CATEGORY) {
			categories[name.trim()] = ids(members);
		}
	}
	const targets: Config['targets'] = {};
	for (const [key, raw] of entries(rawTargets)) {
		const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
		targets[key] = { categories: names(t.categories), enable: ids(t.enable), disable: ids(t.disable) };
	}
	return { categories, targets };
}

/** Looks a Target up by key, ignoring case (repository keys are lower-case, paths may not be). */
export function findTarget(config: Config, key: string): { key: string; config: TargetConfig } | undefined {
	const exact = config.targets[key];
	if (exact) {
		return { key, config: exact };
	}
	const lower = key.toLowerCase();
	const match = Object.keys(config.targets).find(k => k.toLowerCase() === lower);
	return match ? { key: match, config: config.targets[match]! } : undefined;
}

/** Extensions in at least one category, minus this extension itself. */
export function managedExtensions(config: Config, selfId: string): Set<string> {
	const managed = new Set<string>();
	for (const members of Object.values(config.categories)) {
		for (const id of members) {
			managed.add(id);
		}
	}
	managed.delete(selfId.toLowerCase());
	return managed;
}

/** Names of the categories an extension belongs to. */
export function categoriesOf(config: Config, id: string): string[] {
	const lower = id.toLowerCase();
	return Object.keys(config.categories).filter(name => config.categories[name]!.includes(lower));
}

/** Categories after putting an extension in exactly the named ones; categories it is not named in lose it. New names are created. */
export function setMembership(categories: Config['categories'], id: string, names: readonly string[]): Config['categories'] {
	const lower = id.toLowerCase();
	const next: Config['categories'] = {};
	for (const [name, members] of Object.entries(categories)) {
		const without = members.filter(m => m !== lower);
		next[name] = names.includes(name) ? [...without, lower] : without;
	}
	for (const name of names) {
		next[name] ??= [lower];
	}
	return next;
}

/** Whether this extension's own id appears anywhere in the config. */
export function referencesSelf(config: Config, selfId: string): boolean {
	const self = selfId.toLowerCase();
	return Object.values(config.categories).some(m => m.includes(self))
		|| Object.values(config.targets).some(t => t.enable.includes(self) || t.disable.includes(self));
}

/** Setting value for a Target; empty override lists are left out. */
export function serializeTarget(t: TargetConfig): Record<string, string[]> {
	const out: Record<string, string[]> = { categories: t.categories };
	if (t.enable.length) {
		out.enable = t.enable;
	}
	if (t.disable.length) {
		out.disable = t.disable;
	}
	return out;
}
