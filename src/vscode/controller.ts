import { rmSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { findTarget, referencesSelf, type Config } from '../core/config';
import { writeMirror } from '../core/ownedMirror';
import { planTarget, type Plan } from '../core/plan';
import { pendingChanges, reconcile, type EnablementLists, type EnablementStore, type Ownership } from '../core/reconcile';
import { keysOf, type Target } from '../core/target';
import { readInstalled, resolveHost, type Host, type InstalledExtension } from './inventory';
import { readConfig, removeIds, saveTarget } from './settings';
import { currentTarget } from './target';

const ACTIVATED = 'activated';
const OWNED_GLOBAL = 'owned.globalDisabled';
const OWNED_WS_ENABLED = 'owned.workspaceEnabled';
const OWNED_WS_DISABLED = 'owned.workspaceDisabled';
const PICK_FROM_LOCAL = 'Pick from local…';

export interface State {
	config: Config;
	target: Target | undefined;
	installed: Map<string, InstalledExtension>;
	plan: Plan;
	activated: boolean;
}

/** Decides what this window's extensions should be and applies it, asking the user when something needs a choice. */
export class Controller implements vscode.Disposable {
	readonly selfId: string;
	private chain: Promise<unknown> = Promise.resolve();
	private target: Promise<Target | undefined> | undefined;
	private readonly notified = new Set<string>();
	private promptedSetup = false;
	private host: Host | undefined;
	private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
	private readonly log = vscode.window.createOutputChannel('Target Extensions');

	constructor(private readonly context: vscode.ExtensionContext, private readonly store: EnablementStore) {
		this.selfId = context.extension.id.toLowerCase();
		this.status.command = 'targetExtensions.menu';
	}

	dispose(): void {
		this.status.dispose();
		this.log.dispose();
	}

	/** Forget the resolved Target, e.g. after the workspace folders changed. */
	invalidateTarget(): void {
		this.target = undefined;
	}

	/** Re-checks this window and applies changes. Calls run one after another. */
	schedule(): Promise<void> {
		return this.exclusive(() => this.evaluate());
	}

	private exclusive<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.chain.then(fn);
		this.chain = run.catch(error => this.log.appendLine(String(error instanceof Error ? error.stack : error)));
		return run;
	}

	isActivated(): boolean {
		return this.context.globalState.get<boolean>(ACTIVATED, false);
	}

	/** Activation: from now on this machine disables managed extensions. */
	setActivated(value: boolean): Thenable<void> {
		return this.context.globalState.update(ACTIVATED, value);
	}

	async gather(): Promise<State> {
		this.target ??= currentTarget();
		const host = await resolveHost(this.context);
		this.host = host;
		const [target, installed] = await Promise.all([this.target, readInstalled(host)]);
		const config = readConfig();
		return { config, target, installed, plan: planTarget(config, target && keysOf(target), installed, this.selfId), activated: this.isActivated() };
	}

	private readOwned(): Ownership {
		const { globalState, workspaceState } = this.context;
		return {
			globalDisabled: globalState.get<string[]>(OWNED_GLOBAL, []),
			workspaceEnabled: workspaceState.get<string[]>(OWNED_WS_ENABLED, []),
			workspaceDisabled: workspaceState.get<string[]>(OWNED_WS_DISABLED, []),
		};
	}

	private async saveOwned(owned: Ownership): Promise<void> {
		await this.context.globalState.update(OWNED_GLOBAL, owned.globalDisabled);
		await this.context.workspaceState.update(OWNED_WS_ENABLED, owned.workspaceEnabled);
		await this.context.workspaceState.update(OWNED_WS_DISABLED, owned.workspaceDisabled);
		try {
			if (this.host) {
				const dir = this.context.globalStorageUri.fsPath;
				writeMirror(dir, this.host.profile.key, this.host.profile.stateDb, owned.globalDisabled);
				// Replaced by one file per profile; the old one pointed at the wrong profile.
				rmSync(join(dir, 'owned.json'), { force: true });
			}
		} catch (error) {
			this.log.appendLine(`Could not write the uninstall mirror: ${String(error)}`);
		}
	}

	private async evaluate(): Promise<void> {
		const state = await this.gather();
		const { target, plan, installed, activated } = state;
		this.renderStatus(state);
		this.warn(state);

		if (!activated) {
			if (target) {
				this.promptSetup(state);
			}
			return;
		}

		const result = await reconcile({
			store: this.store,
			owned: this.readOwned(),
			managed: plan.managed,
			installed: new Set(installed.keys()),
			protected: plan.protected,
			workspace: target && plan.configured ? { enable: plan.enable, disable: plan.disable } : undefined,
		});
		await this.saveOwned(result.owned);
		if (target && !plan.configured) {
			this.promptSetup(state);
		}
		this.promptReload(result.lists, state, new Set([...plan.managed, ...plan.disable, ...result.owned.workspaceDisabled, ...[...plan.protected].filter(id => installed.has(id))]));
	}

	/** Undoes everything the tool wrote for this machine and this workspace, and switches Activation off. */
	restoreAll(): Promise<void> {
		return this.exclusive(async () => {
			const state = await this.gather();
			const owned = this.readOwned();
			const touched = new Set([...owned.globalDisabled, ...owned.workspaceDisabled, ...owned.workspaceEnabled]);
			const result = await reconcile({
				store: this.store,
				owned,
				managed: new Set(),
				installed: new Set(state.installed.keys()),
				workspace: { enable: new Set(), disable: new Set() },
			});
			await this.saveOwned(result.owned);
			await this.setActivated(false);
			this.renderStatus({ ...state, activated: false });
			this.promptReload(result.lists, state, touched);
		});
	}

	private renderStatus({ target, plan, installed, activated }: State): void {
		if (!target) {
			this.status.hide();
			return;
		}
		let detail: string;
		let tooltip: string;
		if (!activated) {
			detail = 'inactive';
			tooltip = 'Target Extensions is not active on this machine yet. Nothing is disabled.';
		} else if (!plan.configured) {
			detail = 'not configured';
			tooltip = 'This Target has no rules yet; all managed extensions are off.';
		} else {
			const off = [...plan.managed].filter(id => installed.has(id) && !plan.enable.has(id)).length;
			detail = `${off} off`;
			tooltip = `${off} managed extension(s) are off here.`;
		}
		this.status.text = `$(extensions) ${target.label} · ${detail}`;
		this.status.tooltip = `${tooltip}\n${target.key}`;
		this.status.show();
	}

	/** Shows a message once per window session, unless it was already shown. */
	private once(key: string): boolean {
		if (this.notified.has(key)) {
			return false;
		}
		this.notified.add(key);
		return true;
	}

	private warn({ config, plan, activated }: State): void {
		if (referencesSelf(config, this.selfId) && this.once('self')) {
			void vscode.window.showWarningMessage('Target Extensions never manages itself; it is ignored in your categories and targets.');
		}
		if (!activated || !plan.configured) {
			return;
		}
		if (plan.missing.length && this.once(`missing:${plan.missing.join(',')}`)) {
			void vscode.window
				.showWarningMessage(`Not installed on this machine: ${plan.missing.join(', ')}`, 'Install', ...(vscode.env.remoteName ? [PICK_FROM_LOCAL] : []), 'Remove from config')
				.then(async choice => {
					if (choice === 'Install') {
						await this.install(plan.missing);
					} else if (choice === PICK_FROM_LOCAL) {
						await vscode.commands.executeCommand('workbench.extensions.actions.installLocalExtensionsInRemote');
					} else if (choice === 'Remove from config') {
						await removeIds(readConfig(), new Set(plan.missing));
					}
				});
		}
		const deps = plan.addedDependencies.map(d => `${d.id} (required by ${d.requiredBy})`);
		if (deps.length && this.once(`deps:${deps.join(',')}`)) {
			void vscode.window.showInformationMessage(`Also enabled: ${deps.join(', ')}`);
		}
	}

	/**
	 * Installs after the one "Install" click. Without `donotSync`, VS Code asks about Settings Sync once per
	 * extension, so install machine-scoped and then, in a local window, switch sync back on for what was just
	 * installed. Settings Sync does not cover a remote's extensions, so a remote window skips that step.
	 */
	private async install(ids: readonly string[]): Promise<void> {
		const failed: string[] = [];
		for (const id of ids) {
			try {
				await vscode.commands.executeCommand('workbench.extensions.installExtension', id, { donotSync: true });
			} catch (error) {
				failed.push(id);
				this.log.appendLine(`Could not install ${id}: ${String(error)}`);
			}
		}
		if (failed.length) {
			void vscode.window.showWarningMessage(`Could not install: ${failed.join(', ')}`);
		}
		if (vscode.env.remoteName) {
			return;
		}
		const { installed } = await this.gather();
		// The command toggles, so only flip extensions VS Code recorded as machine-scoped.
		for (const id of ids) {
			if (installed.get(id)?.machineScoped) {
				await vscode.commands.executeCommand('workbench.extensions.action.toggleIgnoreExtension', id).then(undefined, error => this.log.appendLine(`Could not sync ${id}: ${String(error)}`));
			}
		}
	}

	private promptSetup({ config, target, plan, activated }: State): void {
		if (!target || this.promptedSetup) {
			return;
		}
		this.promptedSetup = true;

		if (!activated && plan.configured) {
			void vscode.window
				.showInformationMessage(
					`Target Extensions is not active on this machine. Activate it for ${target.label}? Managed extensions will be disabled everywhere except where a Target enables them.`,
					'Activate', 'Not now',
				)
				.then(async choice => {
					if (choice === 'Activate') {
						await this.setActivated(true);
						await this.schedule();
					}
				});
			return;
		}

		if (!Object.keys(config.categories).length) {
			void vscode.window
				.showInformationMessage(`Target Extensions: define a category first, then choose it for ${target.label}.`, 'Create category…')
				.then(choice => choice && vscode.commands.executeCommand('targetExtensions.editCategories'));
			return;
		}

		void vscode.window
			.showInformationMessage(`${target.label} has no extension rules yet. Choose which extensions stay on here.`, 'Choose categories…', 'Enable all', 'Keep off', 'Not now')
			.then(async choice => {
				if (choice === 'Choose categories…') {
					await vscode.commands.executeCommand('targetExtensions.chooseCategories');
				} else if (choice === 'Enable all' || choice === 'Keep off') {
					const existing = findTarget(config, keysOf(target))?.config;
					await saveTarget(config, target, { categories: choice === 'Enable all' ? ['*'] : [], enable: existing?.enable ?? [], disable: existing?.disable ?? [] });
					await this.setActivated(true);
					await this.schedule();
				}
			});
	}

	/** Offers a reload when the extensions running now differ from what the lists say, for the ones this tool manages. */
	private promptReload(after: EnablementLists, { target }: State, universe: ReadonlySet<string>): void {
		const running = new Set(vscode.extensions.all.map(e => e.id.toLowerCase()));
		const diff = pendingChanges(after, running, universe);
		if (!diff.enabled.length && !diff.disabled.length) {
			return;
		}
		if (!this.once(`reload:${diff.enabled.join(',')}|${diff.disabled.join(',')}`)) {
			return;
		}
		const where = target?.label ?? 'this window';
		void vscode.window
			.showInformationMessage(`Extensions for ${where}: ${diff.disabled.length} to turn off, ${diff.enabled.length} to turn on. Reload to apply.`, 'Reload Window', 'Later')
			.then(choice => choice === 'Reload Window' && vscode.commands.executeCommand('workbench.action.reloadWindow'));
	}
}
