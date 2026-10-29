import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { gitInfoFromFiles } from '../core/gitFiles';
import { resolveTarget, type GitInfo, type Target } from '../core/target';

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string | undefined> {
	try {
		const { stdout } = await run('git', args, { cwd, timeout: 5000 });
		return stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

async function gitInfo(folder: string): Promise<GitInfo | undefined> {
	const out = await git(folder, 'rev-parse', '--show-toplevel', '--show-prefix');
	if (!out) {
		return undefined;
	}
	const [root, prefix = ''] = out.split(/\r?\n/);
	return { root: root!, prefix, originUrl: await git(folder, 'config', '--get', 'remote.origin.url') };
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try {
		return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	} catch {
		return undefined;
	}
}

/**
 * The Target of the current window, or undefined when it has none. Remote paths are prefixed with their authority,
 * e.g. `ssh-remote+host/home/me/app`, so they never collide with local ones; their repositories are read through the
 * file system API because `git` here runs on the local machine.
 */
export function currentTarget(): Promise<Target | undefined> {
	const remotes = new Map<string, vscode.Uri>();
	const name = (uri: vscode.Uri): string | undefined => {
		if (uri.scheme === 'file') {
			return uri.fsPath;
		}
		if (uri.scheme !== 'vscode-remote') {
			return undefined;
		}
		const path = `${uri.authority}${uri.path}`;
		remotes.set(path, uri);
		return path;
	};
	const workspaceFile = vscode.workspace.workspaceFile;
	const folders = (vscode.workspace.workspaceFolders ?? []).map(f => name(f.uri)).filter((f): f is string => !!f);
	return resolveTarget({
		workspaceFile: workspaceFile && name(workspaceFile),
		folders,
		home: homedir(),
		git: async folder => {
			const uri = remotes.get(folder);
			if (!uri) {
				return gitInfo(folder);
			}
			const info = await gitInfoFromFiles(uri.path, path => readText(uri.with({ path })));
			return info && { ...info, root: `${uri.authority}${info.root}` };
		},
	});
}
