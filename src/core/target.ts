import { normalizeRepoUrl } from './repoUrl';

export type TargetKind = 'workspace' | 'repo' | 'folder';

export interface Target {
	kind: TargetKind;
	/** Key used in the `targetExtensions.targets` setting, e.g. `repo:github.com/acme/api`. */
	key: string;
	/** Short name for UI. */
	label: string;
	/**
	 * Keys this Target was known by before, such as the repository path from before it had a remote. Rules saved
	 * under one still apply; they move to `key` the next time the Target is saved.
	 */
	aliases: string[];
}

/** Every key whose rules apply to the Target, most current first. */
export const keysOf = (t: Pick<Target, 'key' | 'aliases'>): string[] => [t.key, ...t.aliases];

export interface GitInfo {
	root: string;
	originUrl?: string;
}

export interface TargetEnvironment {
	/** Path of the opened saved `.code-workspace` file, if any. */
	workspaceFile?: string;
	folders: string[];
	home: string;
	git(folder: string): Promise<GitInfo | undefined>;
}

export function tildify(path: string, home: string): string {
	const normalizedHome = home.replace(/[\\/]+$/, '');
	if (normalizedHome && (path === normalizedHome || path.startsWith(`${normalizedHome}/`) || path.startsWith(`${normalizedHome}\\`))) {
		return `~${path.slice(normalizedHome.length)}`.replace(/\\/g, '/');
	}
	return path.replace(/\\/g, '/');
}

function baseName(path: string): string {
	return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
}

/**
 * A window's Target: its workspace file, else its repository, else its folder.
 * Windows with no folder or an unsaved multi-root workspace have none.
 */
export async function resolveTarget(env: TargetEnvironment): Promise<Target | undefined> {
	if (env.workspaceFile) {
		return {
			kind: 'workspace',
			key: `workspace:${tildify(env.workspaceFile, env.home)}`,
			label: baseName(env.workspaceFile).replace(/\.code-workspace$/, ''),
			aliases: [],
		};
	}
	if (env.folders.length !== 1) {
		return undefined;
	}
	const folder = env.folders[0]!;
	const git = await env.git(folder);
	const folderKey = `folder:${tildify(folder, env.home)}`;
	if (git?.originUrl) {
		const normalized = normalizeRepoUrl(git.originUrl);
		return { kind: 'repo', key: `repo:${normalized}`, label: normalized.split('/').slice(-2).join('/'), aliases: [`repo:${tildify(git.root, env.home)}`, folderKey] };
	}
	if (git) {
		return { kind: 'repo', key: `repo:${tildify(git.root, env.home)}`, label: baseName(git.root), aliases: [folderKey] };
	}
	return { kind: 'folder', key: folderKey, label: baseName(folder), aliases: [] };
}
