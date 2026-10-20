import { nextList, type ExtensionIdentifier } from './lists';

/** VS Code's three enablement lists for this window, ids lower-cased. */
export interface EnablementLists {
	globalDisabled: string[];
	workspaceDisabled: string[];
	workspaceEnabled: string[];
}

export interface RawLists {
	globalDisabled: ExtensionIdentifier[];
	workspaceDisabled: ExtensionIdentifier[];
	workspaceEnabled: ExtensionIdentifier[];
}

/** Reads and writes VS Code's enablement lists. Writes only take effect when the window reloads. */
export interface EnablementStore {
	read(): Promise<RawLists>;
	writeGlobalDisabled(list: ExtensionIdentifier[]): Promise<void>;
	writeWorkspaceDisabled(list: ExtensionIdentifier[]): Promise<void>;
	writeWorkspaceEnabled(list: ExtensionIdentifier[]): Promise<void>;
}

/** Ids the tool put into each list. Only these are ever removed again. */
export interface Ownership {
	globalDisabled: string[];
	workspaceDisabled: string[];
	workspaceEnabled: string[];
}

export const emptyOwnership = (): Ownership => ({ globalDisabled: [], workspaceDisabled: [], workspaceEnabled: [] });

export function toLists(raw: RawLists): EnablementLists {
	const lower = (l: ExtensionIdentifier[]) => l.map(e => e.id.toLowerCase());
	return { globalDisabled: lower(raw.globalDisabled), workspaceDisabled: lower(raw.workspaceDisabled), workspaceEnabled: lower(raw.workspaceEnabled) };
}

export interface ReconcileInput {
	store: EnablementStore;
	owned: Ownership;
	/** Managed extensions; the ones installed here get disabled globally. */
	managed: ReadonlySet<string>;
	installed: ReadonlySet<string>;
	/** The Target's wishes. Leave out to leave this workspace's lists alone. */
	workspace?: { enable: ReadonlySet<string>; disable: ReadonlySet<string> };
}

export interface ReconcileResult {
	owned: Ownership;
	lists: EnablementLists;
	wroteGlobal: boolean;
}

/** Brings VS Code's enablement lists in line with what the tool wants, writing only what differs. */
export async function reconcile(input: ReconcileInput): Promise<ReconcileResult> {
	const { store, installed } = input;
	const raw = await store.read();
	const owned = { ...input.owned };
	let wroteGlobal = false;

	const global = nextList(raw.globalDisabled, owned.globalDisabled, [...input.managed].filter(id => installed.has(id)));
	if (global.changed) {
		await store.writeGlobalDisabled(global.list);
		raw.globalDisabled = global.list;
		wroteGlobal = true;
	}
	owned.globalDisabled = global.owned;

	if (input.workspace) {
		const enabled = nextList(raw.workspaceEnabled, owned.workspaceEnabled, [...input.workspace.enable].filter(id => installed.has(id)));
		if (enabled.changed) {
			await store.writeWorkspaceEnabled(enabled.list);
			raw.workspaceEnabled = enabled.list;
		}
		owned.workspaceEnabled = enabled.owned;

		const disabled = nextList(raw.workspaceDisabled, owned.workspaceDisabled, [...input.workspace.disable].filter(id => installed.has(id)));
		if (disabled.changed) {
			await store.writeWorkspaceDisabled(disabled.list);
			raw.workspaceDisabled = disabled.list;
		}
		owned.workspaceDisabled = disabled.owned;
	}

	return { owned, lists: toLists(raw), wroteGlobal };
}

/** Whether an extension is off, by VS Code's precedence: workspace enable, then workspace disable, then global disable. */
export function isDisabled(lists: EnablementLists, id: string): boolean {
	if (lists.workspaceEnabled.includes(id)) {
		return false;
	}
	return lists.workspaceDisabled.includes(id) || lists.globalDisabled.includes(id);
}

/**
 * Extensions whose running state differs from what the lists say it should be, so a reload is needed.
 * Comparing with what is running, not with an earlier snapshot, ignores changes the user already applied
 * live through VS Code's own Enable/Disable.
 */
export function pendingChanges(lists: EnablementLists, running: ReadonlySet<string>, universe: Iterable<string>): { enabled: string[]; disabled: string[] } {
	const enabled: string[] = [];
	const disabled: string[] = [];
	for (const id of universe) {
		const shouldRun = !isDisabled(lists, id);
		if (shouldRun && !running.has(id)) {
			enabled.push(id);
		} else if (!shouldRun && running.has(id)) {
			disabled.push(id);
		}
	}
	return { enabled: enabled.sort(), disabled: disabled.sort() };
}
