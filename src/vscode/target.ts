import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
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
	const root = await git(folder, 'rev-parse', '--show-toplevel');
	if (!root) {
		return undefined;
	}
	return { root, originUrl: await git(folder, 'config', '--get', 'remote.origin.url') };
}

/** The Target of the current window, or undefined when it has none. */
export function currentTarget(): Promise<Target | undefined> {
	const workspaceFile = vscode.workspace.workspaceFile;
	return resolveTarget({
		workspaceFile: workspaceFile?.scheme === 'file' ? workspaceFile.fsPath : undefined,
		folders: (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath),
		home: homedir(),
		git: gitInfo,
	});
}
