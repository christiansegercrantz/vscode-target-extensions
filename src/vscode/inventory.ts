import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import type { InstalledInfo } from '../core/plan';
import { resolveProfile, type Profile } from '../core/profile';

export interface InstalledExtension extends InstalledInfo {
	displayName: string;
	isBuiltin: boolean;
	/** Installed with "Do not sync". */
	machineScoped?: boolean;
}

interface ExtensionsJsonEntry {
	identifier?: { id?: string };
	location?: { path?: string; fsPath?: string } | string;
	relativeLocation?: string;
	metadata?: { isMachineScoped?: boolean };
}

interface Manifest {
	displayName?: string;
	name?: string;
	extensionDependencies?: string[];
	extensionPack?: string[];
	activationEvents?: string[];
}

/** The shared extensions folder and the profile this window runs in. */
export interface Host {
	userDataDir: string;
	extensionsDir: string;
	profile: Profile;
}

const USER_DIR = /^(.*)[\\/]User[\\/]globalStorage[\\/]/;

/** The window's workspace as VS Code keys it in `storage.json`: the workspace file, else the single folder. */
function workspaceUri(): string | undefined {
	const { workspaceFile, workspaceFolders } = vscode.workspace;
	if (workspaceFile && workspaceFile.scheme !== 'untitled') {
		return workspaceFile.toString();
	}
	return workspaceFolders?.length === 1 ? workspaceFolders[0]!.uri.toString() : undefined;
}

export async function resolveHost(context: vscode.ExtensionContext): Promise<Host | undefined> {
	// The storage folder is shared by all profiles: <userData>/User/globalStorage/<extension id>.
	const match = USER_DIR.exec(context.globalStorageUri.fsPath);
	if (!match) {
		return undefined;
	}
	const userDataDir = match[1]!;
	const extensionsDir = dirname(context.extensionPath);
	const storage = await readFile(join(userDataDir, 'User', 'globalStorage', 'storage.json'), 'utf8').then(text => JSON.parse(text) as unknown, () => undefined);
	return { userDataDir, extensionsDir, profile: resolveProfile(storage, workspaceUri(), userDataDir, extensionsDir) };
}

/** Candidate folders for an entry: the recorded absolute location first, then relative to the extensions dir. */
function locationPaths(entry: ExtensionsJsonEntry, extensionsDir: string): string[] {
	const raw = typeof entry.location === 'string' ? entry.location : entry.location?.fsPath ?? entry.location?.path;
	const candidates = [raw?.replace(/^\/([A-Za-z]:)/, '$1'), entry.relativeLocation && join(extensionsDir, entry.relativeLocation)];
	return candidates.filter((p): p is string => !!p);
}

function toExtension(id: string, manifest: Manifest, isBuiltin: boolean): InstalledExtension {
	const display = manifest.displayName && !manifest.displayName.startsWith('%') ? manifest.displayName : manifest.name ?? id;
	return {
		id,
		displayName: display,
		isBuiltin,
		dependencies: [...(manifest.extensionDependencies ?? []), ...(manifest.extensionPack ?? [])].map(d => d.toLowerCase()),
		activationEvents: manifest.activationEvents ?? [],
	};
}

/**
 * Every extension installed for this profile. `vscode.extensions.all` only lists the ones running in the
 * window, so disabled ones are read from the profile's `extensions.json` and the built-in extensions folder.
 */
export async function readInstalled(host: Host | undefined): Promise<Map<string, InstalledExtension>> {
	const result = new Map<string, InstalledExtension>();

	let entries: ExtensionsJsonEntry[] | undefined;
	for (const file of host?.profile.extensionsJson ?? []) {
		entries = await readFile(file, 'utf8').then(text => JSON.parse(text) as ExtensionsJsonEntry[], () => undefined);
		if (entries) {
			break;
		}
	}
	await Promise.all((entries ?? []).map(async entry => {
		const id = entry.identifier?.id?.toLowerCase();
		if (!id || !host) {
			return;
		}
		for (const folder of locationPaths(entry, host.extensionsDir)) {
			try {
				const ext = toExtension(id, JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')) as Manifest, false);
				result.set(id, { ...ext, machineScoped: entry.metadata?.isMachineScoped === true });
				return;
			} catch {
				// Not at this location; try the next, and skip the entry if the folder is gone.
			}
		}
	}));

	// Built-in extensions are not in extensions.json, and a disabled one is not running.
	const builtinDir = join(vscode.env.appRoot, 'extensions');
	const folders = await readdir(builtinDir).catch(() => [] as string[]);
	await Promise.all(folders.map(async folder => {
		try {
			const manifest = JSON.parse(await readFile(join(builtinDir, folder, 'package.json'), 'utf8')) as Manifest & { publisher?: string };
			const id = manifest.publisher && manifest.name ? `${manifest.publisher}.${manifest.name}`.toLowerCase() : undefined;
			if (id && !result.has(id)) {
				result.set(id, toExtension(id, manifest, true));
			}
		} catch {
			// Not an extension folder.
		}
	}));

	for (const ext of vscode.extensions.all) {
		const id = ext.id.toLowerCase();
		if (!result.has(id)) {
			result.set(id, toExtension(id, ext.packageJSON as Manifest, !!(ext.packageJSON as { isBuiltin?: boolean }).isBuiltin));
		}
	}
	return result;
}
