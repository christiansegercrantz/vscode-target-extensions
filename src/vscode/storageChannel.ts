import type * as vscode from 'vscode';
import type { ExtensionIdentifier } from '../core/lists';
import type { EnablementStore, RawLists } from '../core/reconcile';

/** Keys VS Code itself uses for "Disable"/"Enable" (profile scope) and their "(Workspace)" variants. */
export const DISABLED_KEY = 'extensionsIdentifiers/disabled';
export const ENABLED_KEY = 'extensionsIdentifiers/enabled';

/** The extension host's storage channel behind `ExtensionContext.workspaceState` (internal API). */
interface StorageChannel {
	initializeExtensionStorage(shared: boolean, key: string, fallback: unknown): Promise<unknown>;
	setValue(shared: boolean, key: string, value: unknown): Promise<void>;
}

function isStorageChannel(value: unknown): value is StorageChannel {
	const s = value as Partial<StorageChannel> | undefined;
	return typeof s?.initializeExtensionStorage === 'function' && typeof s.setValue === 'function';
}

function identifiers(value: unknown): ExtensionIdentifier[] {
	return Array.isArray(value) ? value.filter((e): e is ExtensionIdentifier => typeof e?.id === 'string') : [];
}

/**
 * Reads and writes VS Code's own enablement lists.
 *
 * VS Code has no API for this (ADR 0001). A memento talks to the window through a storage channel that
 * takes the storage key as a parameter, normally the extension's id, and does not check it. The shared
 * flag selects profile scope, the other flag workspace scope. Changes apply after the window reloads.
 * Returns undefined when a VS Code update has removed the channel.
 */
export function openEnablementStore(workspaceState: vscode.Memento): EnablementStore | undefined {
	const channel = (workspaceState as unknown as { _storage?: unknown })._storage;
	if (!isStorageChannel(channel)) {
		return undefined;
	}
	const read = async (shared: boolean, key: string) => {
		try {
			return identifiers(await channel.initializeExtensionStorage(shared, key, null));
		} catch {
			return [];
		}
	};
	// `undefined` removes the key, as VS Code does for an empty list.
	const write = (shared: boolean, key: string, list: ExtensionIdentifier[]) => channel.setValue(shared, key, list.length ? list : undefined);

	return {
		async read(): Promise<RawLists> {
			const [globalDisabled, workspaceDisabled, workspaceEnabled] = await Promise.all([
				read(true, DISABLED_KEY),
				read(false, DISABLED_KEY),
				read(false, ENABLED_KEY),
			]);
			return { globalDisabled, workspaceDisabled, workspaceEnabled };
		},
		writeGlobalDisabled: list => write(true, DISABLED_KEY, list),
		writeWorkspaceDisabled: list => write(false, DISABLED_KEY, list),
		writeWorkspaceEnabled: list => write(false, ENABLED_KEY, list),
	};
}
