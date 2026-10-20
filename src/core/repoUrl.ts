/** Normalizes a git remote URL so SSH, HTTPS and `.git`-suffixed forms of one repository compare equal. */
export function normalizeRepoUrl(url: string): string {
	const trimmed = url.trim();
	let host: string;
	let path: string;

	const scp = /^(?:[^@/\\]+@)?([^:/\\]{2,}):(?!\/\/)(.+)$/.exec(trimmed);
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
		try {
			const parsed = new URL(trimmed);
			host = parsed.hostname;
			path = decodeURIComponent(parsed.pathname);
		} catch {
			return trimmed.toLowerCase();
		}
	} else if (scp) {
		host = scp[1]!;
		path = scp[2]!;
	} else {
		host = '';
		path = trimmed;
	}

	path = path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
	return (host ? `${host}/${path}` : path).toLowerCase();
}
