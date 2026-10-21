import { ALL_CATEGORY, findTarget, managedExtensions, type Config } from './config';

export interface InstalledInfo {
	id: string;
	/** `extensionDependencies` and `extensionPack` members, lower-cased. */
	dependencies: string[];
	activationEvents?: string[];
}

export interface DependencyNote {
	id: string;
	requiredBy: string;
}

export interface Plan {
	managed: Set<string>;
	/** Remote resolvers and their dependencies must be available before a Target can open. */
	protected: Set<string>;
	configured: boolean;
	/** Managed extensions to enable in this Target, including their dependencies. */
	enable: Set<string>;
	/** The part of `enable` that categories and overrides ask for, before dependencies are added. */
	direct: Set<string>;
	/** Unmanaged extensions the Target disables explicitly. */
	disable: Set<string>;
	addedDependencies: DependencyNote[];
	/** Ids this Target refers to that are not installed. */
	missing: string[];
}

/**
 * What a Target wants: managed extensions enabled by its categories and overrides, with dependencies
 * pulled in, and unmanaged extensions it disables.
 */
export function planTarget(config: Config, targetKeys: string | readonly string[] | undefined, installed: ReadonlyMap<string, InstalledInfo>, selfId: string): Plan {
	const self = selfId.toLowerCase();
	const managed = managedExtensions(config, self);
	const protectedIds = new Set<string>();
	const connections = [...installed.values()].filter(ext => ext.activationEvents?.some(event => event.startsWith('onResolveRemoteAuthority:'))).map(ext => ext.id);
	for (let id = connections.shift(); id !== undefined; id = connections.shift()) {
		if (protectedIds.has(id)) {
			continue;
		}
		protectedIds.add(id);
		managed.delete(id);
		connections.push(...(installed.get(id)?.dependencies ?? []));
	}
	const entry = targetKeys ? findTarget(config, targetKeys)?.config : undefined;
	const plan: Plan = { managed, protected: protectedIds, configured: !!entry, enable: new Set(), direct: new Set(), disable: new Set(), addedDependencies: [], missing: [] };
	if (!entry) {
		return plan;
	}

	const referenced = new Set<string>();
	for (const category of entry.categories) {
		if (category === ALL_CATEGORY) {
			managed.forEach(id => plan.enable.add(id));
			continue;
		}
		for (const id of config.categories[category] ?? []) {
			referenced.add(id);
			if (managed.has(id)) {
				plan.enable.add(id);
			}
		}
	}
	for (const id of entry.enable) {
		referenced.add(id);
		if (managed.has(id)) {
			plan.enable.add(id);
		}
	}
	for (const id of entry.disable) {
		referenced.add(id);
		plan.enable.delete(id);
		if (!managed.has(id) && id !== self && !protectedIds.has(id)) {
			plan.disable.add(id);
		}
	}

	plan.direct = new Set(plan.enable);

	// A dependency of something enabled must be on, even if an override or category left it out.
	const visited = new Set(plan.enable);
	const queue = [...plan.enable];
	for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
		for (const dep of installed.get(id)?.dependencies ?? []) {
			if (visited.has(dep) || dep === self) {
				continue;
			}
			visited.add(dep);
			plan.disable.delete(dep);
			if (managed.has(dep)) {
				plan.enable.add(dep);
				plan.addedDependencies.push({ id: dep, requiredBy: id });
			}
			queue.push(dep);
		}
	}

	plan.missing = [...referenced].filter(id => id !== self && !installed.has(id)).sort();
	return plan;
}
