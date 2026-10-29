import { posix } from 'node:path';
import type { GitInfo } from './target';

/** Reads a text file, or undefined when it is missing or a directory. */
export type ReadText = (path: string) => Promise<string | undefined>;

function originUrl(config: string): string | undefined {
	let inOrigin = false;
	for (const line of config.split(/\r?\n/)) {
		const section = /^\s*\[(.*)\]/.exec(line);
		if (section) {
			inOrigin = /^remote\s+"origin"$/.test(section[1]!.trim());
			continue;
		}
		const url = inOrigin && /^\s*url\s*=\s*(.+?)\s*$/.exec(line);
		if (url) {
			return url[1];
		}
	}
	return undefined;
}

/**
 * Git root and origin of a POSIX `folder`, from the files under `.git` alone. For file systems where `git` cannot run,
 * such as a remote window's. Follows the `.git` file and `commondir` that linked worktrees and submodules use.
 */
export async function gitInfoFromFiles(folder: string, read: ReadText): Promise<GitInfo | undefined> {
	const start = posix.normalize(folder);
	for (let dir = start; ; dir = posix.dirname(dir)) {
		let gitDir = posix.join(dir, '.git');
		let config = await read(posix.join(gitDir, 'config'));
		if (config === undefined) {
			const pointer = /^gitdir:\s*(.+?)\s*$/m.exec((await read(gitDir)) ?? '');
			if (pointer) {
				gitDir = posix.resolve(dir, pointer[1]!);
				const common = (await read(posix.join(gitDir, 'commondir')))?.trim();
				config = await read(posix.join(common ? posix.resolve(gitDir, common) : gitDir, 'config'));
			}
		}
		if (config !== undefined) {
			return { root: dir, originUrl: originUrl(config), prefix: posix.relative(dir, start) };
		}
		if (dir === posix.dirname(dir)) {
			return undefined;
		}
	}
}
