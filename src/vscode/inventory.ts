import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import type { InstalledInfo } from '../core/plan';

export interface InstalledExtension extends InstalledInfo {
	displayName: string;
	isBuiltin: boolean;
}

interface ExtensionsJsonEntry {
	identifier?: { id?: string };
	location?: { path?: string; fsPath?: string } | string;
	relativeLocation?: string;
}

interface Manifest {
	displayName?: string;
	name?: string;
	extensionDependencies?: string[];
	extensionPack?: string[];
}

const GLOBAL_STORAGE = /^(.*)[\\/]User[\\/](?:profiles[\\/]([^\\/]+)[\\/])?globalStorage[\\/]/;

/** Where this window's profile keeps its data, derived from the extension's own storage location. */
export interface HostPaths {
	userDataDir: string;
	extensionsDir: string;
	/** `extensions.json` files to try, current profile first. */
	extensionsJson: string[];
}

export function hostPaths(context: vscode.ExtensionContext): HostPaths | undefined {
	const match = GLOBAL_STORAGE.exec(context.globalStorageUri.fsPath);
	if (!match) {
		return undefined;
	}
	const userDataDir = match[1]!;
	const extensionsDir = dirname(context.extensionPath);
	const files = [join(extensionsDir, 'extensions.json')];
	if (match[2]) {
		files.unshift(join(userDataDir, 'User', 'profiles', match[2], 'extensions.json'));
	}
	return { userDataDir, extensionsDir, extensionsJson: files };
}

function locationPath(entry: ExtensionsJsonEntry, extensionsDir: string): string | undefined {
	if (entry.relativeLocation) {
		return join(extensionsDir, entry.relativeLocation);
	}
	const raw = typeof entry.location === 'string' ? entry.location : entry.location?.fsPath ?? entry.location?.path;
	return raw?.replace(/^\/([A-Za-z]:)/, '$1');
}

function toExtension(id: string, manifest: Manifest, isBuiltin: boolean): InstalledExtension {
	const display = manifest.displayName && !manifest.displayName.startsWith('%') ? manifest.displayName : manifest.name ?? id;
	return {
		id,
		displayName: display,
		isBuiltin,
		dependencies: [...(manifest.extensionDependencies ?? []), ...(manifest.extensionPack ?? [])].map(d => d.toLowerCase()),
	};
}

/**
 * Every extension installed for this profile. `vscode.extensions.all` only lists the ones running in the
 * window, so disabled ones are read from the profile's `extensions.json` and the built-in extensions folder.
 */
export async function readInstalled(paths: HostPaths | undefined): Promise<Map<string, InstalledExtension>> {
	const result = new Map<string, InstalledExtension>();

	let entries: ExtensionsJsonEntry[] | undefined;
	for (const file of paths?.extensionsJson ?? []) {
		entries = await readFile(file, 'utf8').then(text => JSON.parse(text) as ExtensionsJsonEntry[], () => undefined);
		if (entries) {
			break;
		}
	}
	await Promise.all((entries ?? []).map(async entry => {
		const id = entry.identifier?.id?.toLowerCase();
		const folder = paths && locationPath(entry, paths.extensionsDir);
		if (!id || !folder) {
			return;
		}
		try {
			result.set(id, toExtension(id, JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')) as Manifest, false));
		} catch {
			// The extension folder is gone or unreadable; skip it.
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
