import { normalizeRepoUrl } from './repoUrl';

/** `subfolder` is a folder inside a Repository, below its root. */
export type TargetKind = 'workspace' | 'repo' | 'subfolder' | 'folder';

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
	/** Enclosing Targets, nearest first. While this Target has no rules, the nearest one with rules lends its own. */
	parents: Target[];
}

/** Every key whose rules apply to the Target, most current first. */
export const keysOf = (t: Pick<Target, 'key' | 'aliases'>): string[] => [t.key, ...t.aliases];

/** Key of the home folder; inheriting from it is the catch-all default and is not announced. */
export const HOME_FOLDER_KEY = 'folder:~';

/** Where first rules for a Target are saved: the Repository for a subfolder of one, otherwise the Target itself. */
export function setupTarget(t: Target): Target {
	return t.kind === 'subfolder' ? t.parents.find(p => p.kind === 'repo') ?? t : t;
}

export interface GitInfo {
	root: string;
	originUrl?: string;
	/** Path of the folder relative to `root`, `/`-separated; empty at the root. Derived from the paths when missing. */
	prefix?: string;
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
	return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

/** The directory containing `path`, or undefined at a root (`/`, `C:\`, or a remote authority). */
export function parentPath(path: string): string | undefined {
	const p = path.replace(/[\\/]+$/, '');
	const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
	if (i < 0) {
		return undefined;
	}
	if (i === 0) {
		return p.length > 1 ? p[0] : undefined;
	}
	const parent = p.slice(0, i);
	return /^[A-Za-z]:$/.test(parent) ? `${parent}${p[i]}` : parent;
}

function folderTarget(path: string, home: string, parents: Target[]): Target {
	return { kind: 'folder', key: `folder:${tildify(path, home)}`, label: baseName(path), aliases: [], parents };
}

/** Folder Targets for every directory above `path`, nearest first. */
function foldersAbove(path: string, home: string): Target[] {
	const paths: string[] = [];
	for (let p = parentPath(path); p !== undefined; p = parentPath(p)) {
		paths.push(p);
	}
	let parents: Target[] = [];
	for (const p of paths.reverse()) {
		parents = [folderTarget(p, home, parents), ...parents];
	}
	return parents;
}

function relativeInside(root: string, folder: string): string {
	const r = root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
	const f = folder.replace(/\\/g, '/').replace(/\/+$/, '');
	return f.toLowerCase().startsWith(`${r}/`) ? f.slice(r.length + 1) : '';
}

/**
 * A window's Target: its workspace file, else its repository (or the subfolder of it that is open), else its folder.
 * Windows with no folder or an unsaved multi-root workspace have none.
 */
export async function resolveTarget(env: TargetEnvironment): Promise<Target | undefined> {
	if (env.workspaceFile) {
		return {
			kind: 'workspace',
			key: `workspace:${tildify(env.workspaceFile, env.home)}`,
			label: baseName(env.workspaceFile).replace(/\.code-workspace$/, ''),
			aliases: [],
			parents: [],
		};
	}
	if (env.folders.length !== 1) {
		return undefined;
	}
	const folder = env.folders[0]!;
	const git = await env.git(folder);
	if (!git) {
		return folderTarget(folder, env.home, foldersAbove(folder, env.home));
	}

	// Walk up from the opened folder rather than using `git.root`, so paths keep the form the user opened them by.
	const segments = (git.prefix ?? relativeInside(git.root, folder)).split(/[\\/]+/).filter(Boolean);
	const levels = [folder];
	for (const _ of segments) {
		levels.unshift(parentPath(levels[0]!) ?? levels[0]!);
	}
	const root = levels[0]!;
	const remote = git.originUrl ? normalizeRepoUrl(git.originUrl) : undefined;
	const pathKey = `repo:${tildify(git.root, env.home)}`;
	const repoKey = remote ? `repo:${remote}` : pathKey;

	let target: Target = {
		kind: 'repo',
		key: repoKey,
		label: remote ? remote.split('/').slice(-2).join('/') : baseName(git.root),
		aliases: [...(remote ? [pathKey] : []), `folder:${tildify(root, env.home)}`],
		parents: foldersAbove(root, env.home),
	};
	segments.forEach((_, i) => {
		const rel = segments.slice(0, i + 1).join('/').toLowerCase();
		const path = levels[i + 1]!;
		target = {
			kind: 'subfolder',
			key: `${repoKey}#${rel}`,
			label: baseName(path),
			aliases: [...(remote ? [`${pathKey}#${rel}`] : []), `folder:${tildify(path, env.home)}`],
			parents: [target, ...target.parents],
		};
	});
	return target;
}
