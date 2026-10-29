import * as vscode from 'vscode';
import type { EnablementStore } from './core/reconcile';
import { registerCommands } from './vscode/commands';
import { Controller } from './vscode/controller';
import { deleteTarget, readConfig, saveTarget } from './vscode/settings';
import { openEnablementStore } from './vscode/storageChannel';

const DEBOUNCE_MS = 400;

/** Handed to the integration tests, which run in the same extension host. */
export interface TestApi {
	controller: Controller;
	store: EnablementStore;
	settings: { readConfig: typeof readConfig; saveTarget: typeof saveTarget; deleteTarget: typeof deleteTarget };
}

export function activate(context: vscode.ExtensionContext): TestApi | undefined {
	const store = openEnablementStore(context.workspaceState);
	if (!store) {
		void vscode.window.showWarningMessage(
			"Target Extensions can't reach VS Code's extension enablement storage; a VS Code update probably changed it. The extension is inactive.",
		);
		return undefined;
	}

	const controller = new Controller(context, store);
	context.subscriptions.push(controller);
	registerCommands(context, controller);

	let timer: NodeJS.Timeout | undefined;
	const rescan = () => {
		clearTimeout(timer);
		timer = setTimeout(() => void controller.schedule(), DEBOUNCE_MS);
	};
	context.subscriptions.push(
		{ dispose: () => clearTimeout(timer) },
		vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('targetExtensions') && rescan()),
		vscode.extensions.onDidChange(rescan),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			controller.invalidateTarget();
			rescan();
		}),
	);
	void controller.schedule();
	return { controller, store, settings: { readConfig, saveTarget, deleteTarget } };
}

export function deactivate(): void {}
