import { join } from 'node:path';

/** Location VS Code records in `storage.json` for the Default profile. */
const DEFAULT_LOCATION = '__default__profile__';

export interface Profile {
	/** `default`, or the profile's folder name under `User/profiles`. */
	key: string;
	/** `extensions.json` files to read, most specific first. */
	extensionsJson: string[];
	/** The profile's state database, which holds its "Disable" list. */
	stateDb: string;
}

interface StorageJson {
	profileAssociations?: { workspaces?: Record<string, unknown> };
	userDataProfiles?: { location?: string; useDefaultFlags?: { extensions?: boolean } }[];
}

/**
 * The profile a window runs in. An extension's `globalStorageUri` is shared by every profile, so the only
 * place that says which profile a workspace uses is VS Code's `storage.json`. Windows without an entry,
 * such as empty windows, get the Default profile, as VS Code gives them.
 */
export function resolveProfile(storage: unknown, workspaceUri: string | undefined, userDataDir: string, extensionsDir: string): Profile {
	const data = (storage && typeof storage === 'object' ? storage : {}) as StorageJson;
	const defaultJson = join(extensionsDir, 'extensions.json');
	const location = workspaceUri ? data.profileAssociations?.workspaces?.[workspaceUri] : undefined;

	const fallback: Profile = { key: 'default', extensionsJson: [defaultJson], stateDb: join(userDataDir, 'User', 'globalStorage', 'state.vscdb') };
	if (typeof location !== 'string' || location === DEFAULT_LOCATION || !/^[^\\/]+$/.test(location)) {
		return fallback;
	}
	const known = data.userDataProfiles?.find(p => p.location === location);
	if (!known) {
		return fallback;
	}
	const dir = join(userDataDir, 'User', 'profiles', location);
	return {
		key: location,
		// A profile that shares the Default profile's extensions has no list of its own.
		extensionsJson: known.useDefaultFlags?.extensions ? [defaultJson] : [join(dir, 'extensions.json'), defaultJson],
		stateDb: join(dir, 'globalStorage', 'state.vscdb'),
	};
}
