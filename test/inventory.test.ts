import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { parseConfig } from '../src/core/config';
import { planTarget } from '../src/core/plan';
import { readInstalled } from '../src/vscode/inventory';

vi.mock('vscode', () => ({
	env: { appRoot: '' },
	extensions: { all: [] },
}));

let directory: string | undefined;
afterEach(async () => {
	if (directory) {
		await rm(directory, { recursive: true, force: true });
		directory = undefined;
	}
});

it('recognizes a disabled SSH resolver from its installed manifest, without a running extension', async () => {
	directory = await mkdtemp(join(tmpdir(), 'target-extensions-inventory-'));
	const ssh = 'ms-vscode-remote.remote-ssh';
	const folder = join(directory, 'remote-ssh');
	const extensionsJson = join(directory, 'extensions.json');
	await mkdir(folder);
	await writeFile(join(folder, 'package.json'), JSON.stringify({
		name: 'remote-ssh',
		activationEvents: ['onResolveRemoteAuthority:ssh'],
		extensionDependencies: ['Remote.Helper'],
	}));
	await writeFile(extensionsJson, JSON.stringify([{ identifier: { id: ssh }, relativeLocation: 'remote-ssh' }]));
	const installed = await readInstalled({
		userDataDir: directory,
		extensionsDir: directory,
		profile: { key: 'default', extensionsJson: [extensionsJson], stateDb: join(directory, 'state.vscdb') },
	});
	expect(installed.get(ssh)?.activationEvents).toEqual(['onResolveRemoteAuthority:ssh']);
	const plan = planTarget(parseConfig({ remote: [ssh, 'remote.helper'] }, {}), undefined, installed, 'me.target-extensions');
	expect(plan.protected).toEqual(new Set([ssh, 'remote.helper']));
	expect(plan.managed.size).toBe(0);
});
