import { normalizeRepoUrl } from './repoUrl';

export type TargetKind = 'workspace' | 'repo' | 'folder';

export interface Target {
	kind: TargetKind;
	/** Key used in the `targetExtensions.targets` setting, e.g. `repo:github.com/acme/api`. */
	key: string;
	/** Short name for UI. */
	label: string;
}

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
		};
	}
	if (env.folders.length !== 1) {
		return undefined;
	}
	const folder = env.folders[0]!;
	const git = await env.git(folder);
	if (git?.originUrl) {
		const normalized = normalizeRepoUrl(git.originUrl);
		return { kind: 'repo', key: `repo:${normalized}`, label: normalized.split('/').slice(-2).join('/') };
	}
	if (git) {
		return { kind: 'repo', key: `repo:${tildify(git.root, env.home)}`, label: baseName(git.root) };
	}
	return { kind: 'folder', key: `folder:${tildify(folder, env.home)}`, label: baseName(folder) };
}
