export interface ExtensionIdentifier {
	id: string;
	uuid?: string;
}

export interface ListChange {
	list: ExtensionIdentifier[];
	/** Lower-case ids the tool owns in the list after the change. */
	owned: string[];
	changed: boolean;
}

/**
 * Next version of one of VS Code's enablement lists. Entries the user put there are kept; only entries
 * the tool owns are added and removed, and an id the user already listed is never taken over.
 */
export function nextList(current: ExtensionIdentifier[], owned: readonly string[], wanted: Iterable<string>): ListChange {
	const ownedSet = new Set(owned);
	const users = current.filter(e => !ownedSet.has(e.id.toLowerCase()));
	const userIds = new Set(users.map(e => e.id.toLowerCase()));
	const mine = [...new Set(wanted)].filter(id => !userIds.has(id)).sort();
	const list = [...users, ...mine.map(id => ({ id }))];
	const before = current.map(e => e.id.toLowerCase()).sort().join('\n');
	const after = list.map(e => e.id.toLowerCase()).sort().join('\n');
	return { list, owned: mine, changed: before !== after };
}
