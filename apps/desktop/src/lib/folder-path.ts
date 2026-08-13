// One canonical form for a workspace folder path, used wherever two folders have
// to be recognised as the same project.
//
// The sidebar's project list is a union of three independently-produced strings
// for the same directory: the workspace store's `recentFolders` (whatever the
// folder browser or composer picker handed back), a conversation's `folderPath`
// (what Core stamped when the run started), and an imported thread's `cwd` (what
// Claude Code / Codex wrote into its own transcript). Nothing forced those three
// producers to agree on punctuation, and the union keyed on raw string equality —
// so a single trailing slash, or a doubled separator, split one project into two
// sidebar folders with the same visible name. That is the "auto-import made its
// own folder even though I already have chats there" report.
//
// Deliberately conservative. It does NOT lowercase (macOS and Windows are
// case-insensitive but case-PRESERVING, and folding the case would change the
// name the sidebar draws), does not resolve symlinks or `..` (that needs the
// filesystem, and this runs in the renderer with no access to it), and does not
// expand `~` (no path producer here emits one). It normalises exactly what the
// producers actually disagree about: separator style and redundant separators.

/** Matches a run of either separator, so a Windows path normalises too. */
const SEPARATOR_RUN = /[\\/]+/g;

/**
 * Canonical key for a folder path. Same directory → same key.
 *
 * Use for comparison, deduplication, and Map/Set keys ONLY. Keep the original
 * string for display and for anything sent back to Core: this collapses `\` to
 * `/`, which is right for a key and wrong for a Windows path on the wire.
 */
export function folderKey(path: string): string {
	const collapsed = path.trim().replace(SEPARATOR_RUN, "/");
	// Strip trailing separators, but never reduce a root ("/" or "C:/") to "".
	const trimmed = collapsed.replace(/\/+$/, "");
	return trimmed === "" ? collapsed.slice(0, 1) : trimmed;
}

/**
 * Deduplicate paths by [`folderKey`], keeping the FIRST spelling of each. First
 * wins because callers pass their most-authoritative source first (the active
 * folder, then recents, then conversation-derived paths).
 */
export function dedupeFolders(paths: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const path of paths) {
		const key = folderKey(path);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(path);
	}
	return out;
}

/** True when both strings name the same folder. */
export function sameFolder(a: string, b: string): boolean {
	return folderKey(a) === folderKey(b);
}
