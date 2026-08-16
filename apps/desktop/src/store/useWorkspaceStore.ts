import { isDitherColor } from "@ryu/ui/components/dither-kit/palette";
import type { GlyphDitherValue, GlyphValue } from "@ryu/ui/components/glyph.ts";
import { create } from "zustand";
import { listDirectory } from "@/src/lib/api/workspace.ts";
import { sameFolder } from "@/src/lib/folder-path.ts";
import { isLocalNode, useNodeStore } from "./useNodeStore.ts";

const STORAGE_KEY = "ryu_workspace_folder";
const RECENTS_KEY = "ryu_workspace_recents";
const REMOVED_KEY = "ryu_workspace_removed";
const WORKTREE_MODE_KEY = "ryu_workspace_worktree_mode";
const WORKTREE_BRANCH_KEY = "ryu_workspace_worktree_branch";
const TERMINAL_SHELL_KEY = "ryu_workspace_terminal_shell";
const ICONS_KEY = "ryu_workspace_icons";
const NAMES_KEY = "ryu_workspace_names";
const ENVIRONMENTS_KEY = "ryu_workspace_environments_v1";
const ACTIVE_ENVIRONMENTS_KEY = "ryu_workspace_active_environments_v1";
const MAX_RECENTS = 10;

/**
 * A per-project custom glyph, keyed by folder path. Uses the shared
 * {@link GlyphValue} shape (avatar / icon / emoji / dicebear) — purely
 * presentational desktop-local state in localStorage.
 */
export type ProjectIcon = Exclude<GlyphValue, null>;

export interface ProjectEnvironmentScripts {
	default: string;
	linux: string;
	macos: string;
	windows: string;
}

export interface ProjectEnvironmentVariable {
	id: string;
	key: string;
	value: string;
}

export interface ProjectEnvironmentAction {
	id: string;
	name: string;
	scripts: ProjectEnvironmentScripts;
}

/** A named, desktop-local setup profile for one project folder. */
export interface ProjectEnvironment {
	actions: ProjectEnvironmentAction[];
	cleanup: ProjectEnvironmentScripts;
	id: string;
	name: string;
	setup: ProjectEnvironmentScripts;
	variables: ProjectEnvironmentVariable[];
}

export const emptyEnvironmentScripts = (): ProjectEnvironmentScripts => ({
	default: "",
	macos: "",
	linux: "",
	windows: "",
});

/** Parse an optional dither layer from a stored glyph object. */
function normalizeDither(raw: unknown): GlyphDitherValue | undefined {
	if (!raw || typeof raw !== "object") {
		return undefined;
	}
	const d = raw as Record<string, unknown>;
	if (!isDitherColor(d.from)) {
		return undefined;
	}
	const direction =
		d.direction === "down" || d.direction === "left" || d.direction === "right"
			? d.direction
			: "up";
	return {
		from: d.from,
		to: isDitherColor(d.to) ? d.to : null,
		direction,
	};
}

/** Migrate legacy `{ type, value }` icons and validate new glyph shapes. */
function normalizeProjectIcon(raw: unknown): ProjectIcon | null {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const r = raw as Record<string, unknown>;
	const dither = normalizeDither(r.dither);

	// Legacy shape from the emoji-grid / upload dialog.
	if (r.type === "emoji" && typeof r.value === "string") {
		return { kind: "emoji", emoji: r.value };
	}
	if (r.type === "image" && typeof r.value === "string") {
		return { kind: "avatar", dataUrl: r.value };
	}

	if (r.kind === "emoji" && typeof r.emoji === "string") {
		return {
			kind: "emoji",
			emoji: r.emoji,
			...(dither ? { dither } : {}),
		};
	}
	if (r.kind === "avatar" && typeof r.dataUrl === "string") {
		return { kind: "avatar", dataUrl: r.dataUrl };
	}
	if (r.kind === "icon" && typeof r.id === "string") {
		return {
			kind: "icon",
			id: r.id,
			...(typeof r.color === "string" ? { color: r.color } : {}),
			...(dither ? { dither } : {}),
		};
	}
	if (
		r.kind === "dicebear" &&
		typeof r.style === "string" &&
		typeof r.seed === "string"
	) {
		return { kind: "dicebear", style: r.style, seed: r.seed };
	}
	if (r.kind === "dither" && dither) {
		return { kind: "dither", dither };
	}
	return null;
}

interface WorkspaceState {
	/** Selected environment id for each project folder. */
	activeProjectEnvironments: Record<string, string>;
	/**
	 * Register a folder as a project WITHOUT making it the active folder or
	 * touching disk. Adds it to `recentFolders` (so it shows in the sidebar's
	 * Projects section even before it has chats) and un-hides it if it was
	 * previously removed. Used by auto-import to surface the folders imported
	 * threads ran in — unlike `setFolder`, it neither `stat`s the path (the cwd
	 * may not exist on this machine) nor changes what a new chat runs against.
	 */
	addProjectFolder: (path: string) => void;
	clearFolder: () => void;
	/** Remove any custom icon for a project, reverting it to the folder glyph. */
	clearProjectIcon: (path: string) => void;
	/** Clear a custom display name, reverting to the folder basename. */
	clearProjectName: (path: string) => void;
	folder: string | null;
	/** Named local setup profiles, keyed by project folder path. */
	projectEnvironments: Record<string, ProjectEnvironment[]>;
	/** Custom per-project glyphs (avatar/icon/emoji/dicebear), keyed by folder path. */
	projectIcons: Record<string, ProjectIcon>;
	/**
	 * Optional display labels keyed by folder path. When unset, the sidebar and
	 * picker fall back to the folder basename. Purely presentational — the on-disk
	 * path is unchanged.
	 */
	projectNames: Record<string, string>;
	recentFolders: string[];
	/** Replace the suggested branch name with a freshly generated friendly one. */
	regenerateWorktreeBranch: () => void;
	/**
	 * Paths the user has explicitly removed from the app's project list. The
	 * sidebar's project list is the union of `recentFolders` and the folders of
	 * existing conversations (durable Core data), so a folder that still has
	 * chats would otherwise reappear after dropping it from recents. Remembering
	 * removals keeps "Remove from app" sticky; (re)importing the folder un-hides
	 * it. Synced across the sidebar and the composer's project picker.
	 */
	removedProjects: string[];
	/**
	 * Remove a project from the app everywhere: drop it from recents and remember
	 * it as removed so its conversations don't resurrect it in the sidebar.
	 */
	removeProject: (path: string) => void;
	/** Drop a recent without marking it removed (e.g. a stale/missing path). */
	removeRecentFolder: (path: string) => void;
	selectProjectEnvironment: (path: string, environmentId: string) => void;
	setFolder: (path: string) => Promise<void>;
	setProjectEnvironments: (
		path: string,
		environments: ProjectEnvironment[],
		activeId: string | null
	) => void;
	/** Assign a custom glyph (avatar/icon/emoji/dicebear) to a project folder. */
	setProjectIcon: (path: string, icon: ProjectIcon) => void;
	/** Assign a custom sidebar/picker label for a project folder. */
	setProjectName: (path: string, name: string) => void;
	/**
	 * Choose which shell the built-in terminal and git actions run through.
	 * The value is either `"auto"` (the OS default) or one of the allowlisted
	 * shell names understood by the Rust `shell_execute` command.
	 */
	setTerminalShell: (shell: string) => void;
	setWorktreeBranch: (name: string) => void;
	setWorktreeMode: (on: boolean) => void;
	/**
	 * The shell the built-in terminal and git actions run through: `"auto"` for
	 * the OS default, or an allowlisted shell name (bash/zsh/sh/fish/powershell/
	 * pwsh/cmd). Desktop-local preference, persisted in localStorage.
	 */
	terminalShell: string;
	/** Desired branch name for the *next* new worktree (editable, friendly). */
	worktreeBranch: string;
	/**
	 * When true, a folder-rooted ACP run executes inside a persistent, isolated
	 * git worktree for the conversation (created on the first message, reused on
	 * later turns) instead of mutating the selected folder directly.
	 */
	worktreeMode: boolean;
}

function loadRecents(): string[] {
	try {
		const raw = localStorage.getItem(RECENTS_KEY);
		if (!raw) {
			return [];
		}
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function saveRecents(recents: string[]) {
	localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
}

function loadRemoved(): string[] {
	try {
		const raw = localStorage.getItem(REMOVED_KEY);
		if (!raw) {
			return [];
		}
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function saveRemoved(removed: string[]) {
	localStorage.setItem(REMOVED_KEY, JSON.stringify(removed));
}

function loadIcons(): Record<string, ProjectIcon> {
	try {
		const raw = localStorage.getItem(ICONS_KEY);
		if (!raw) {
			return {};
		}
		const parsed = JSON.parse(raw);
		if (!(parsed && typeof parsed === "object")) {
			return {};
		}
		const out: Record<string, ProjectIcon> = {};
		for (const [path, value] of Object.entries(
			parsed as Record<string, unknown>
		)) {
			const icon = normalizeProjectIcon(value);
			if (icon) {
				out[path] = icon;
			}
		}
		return out;
	} catch {
		return {};
	}
}

function saveIcons(icons: Record<string, ProjectIcon>) {
	localStorage.setItem(ICONS_KEY, JSON.stringify(icons));
}

function loadNames(): Record<string, string> {
	try {
		const raw = localStorage.getItem(NAMES_KEY);
		if (!raw) {
			return {};
		}
		const parsed = JSON.parse(raw);
		if (!(parsed && typeof parsed === "object")) {
			return {};
		}
		const out: Record<string, string> = {};
		for (const [path, value] of Object.entries(
			parsed as Record<string, unknown>
		)) {
			if (typeof value === "string" && value.trim()) {
				out[path] = value.trim();
			}
		}
		return out;
	} catch {
		return {};
	}
}

function saveNames(names: Record<string, string>) {
	localStorage.setItem(NAMES_KEY, JSON.stringify(names));
}

function isScripts(value: unknown): value is ProjectEnvironmentScripts {
	if (!(value && typeof value === "object")) {
		return false;
	}
	const scripts = value as Record<string, unknown>;
	return ["default", "macos", "linux", "windows"].every(
		(key) => typeof scripts[key] === "string"
	);
}

function normalizeEnvironments(raw: unknown): ProjectEnvironment[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const environments: ProjectEnvironment[] = [];
	for (const value of raw) {
		if (!(value && typeof value === "object")) {
			continue;
		}
		const environment = value as Record<string, unknown>;
		if (
			typeof environment.id !== "string" ||
			typeof environment.name !== "string" ||
			!environment.name.trim() ||
			!isScripts(environment.setup) ||
			!isScripts(environment.cleanup)
		) {
			continue;
		}
		const variables = Array.isArray(environment.variables)
			? environment.variables.filter(
					(variable): variable is ProjectEnvironmentVariable =>
						Boolean(
							variable &&
								typeof variable === "object" &&
								typeof variable.id === "string" &&
								typeof variable.key === "string" &&
								typeof variable.value === "string"
						)
				)
			: [];
		const actions = Array.isArray(environment.actions)
			? environment.actions.filter(
					(action): action is ProjectEnvironmentAction =>
						Boolean(
							action &&
								typeof action === "object" &&
								typeof action.id === "string" &&
								typeof action.name === "string" &&
								isScripts(action.scripts)
						)
				)
			: [];
		environments.push({
			id: environment.id,
			name: environment.name.trim(),
			setup: environment.setup,
			cleanup: environment.cleanup,
			variables,
			actions,
		});
	}
	return environments;
}

function loadProjectEnvironments(): Record<string, ProjectEnvironment[]> {
	try {
		const parsed = JSON.parse(localStorage.getItem(ENVIRONMENTS_KEY) ?? "{}");
		if (!(parsed && typeof parsed === "object")) {
			return {};
		}
		const result: Record<string, ProjectEnvironment[]> = {};
		for (const [path, value] of Object.entries(parsed)) {
			const environments = normalizeEnvironments(value);
			if (environments.length > 0) {
				result[path] = environments;
			}
		}
		return result;
	} catch {
		return {};
	}
}

function loadActiveProjectEnvironments(): Record<string, string> {
	try {
		const parsed = JSON.parse(
			localStorage.getItem(ACTIVE_ENVIRONMENTS_KEY) ?? "{}"
		);
		if (!(parsed && typeof parsed === "object")) {
			return {};
		}
		return Object.fromEntries(
			Object.entries(parsed).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string"
			)
		);
	} catch {
		return {};
	}
}

// Conductor-style memorable, collision-resistant names so parallel worktrees
// are scannable at a glance (e.g. `ryu/swift-otter`) instead of opaque uuids.
const NAME_ADJECTIVES = [
	"swift",
	"brave",
	"calm",
	"bright",
	"lucky",
	"bold",
	"quiet",
	"eager",
	"nimble",
	"sunny",
	"amber",
	"cosmic",
	"crisp",
	"merry",
	"royal",
] as const;
const NAME_NOUNS = [
	"otter",
	"falcon",
	"maple",
	"comet",
	"harbor",
	"willow",
	"pixel",
	"ember",
	"cedar",
	"koi",
	"lark",
	"mesa",
	"reef",
	"finch",
	"opal",
] as const;

export function suggestWorktreeBranch(): string {
	const adj =
		NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)];
	const noun = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)];
	return `ryu/${adj}-${noun}`;
}

function loadWorktreeBranch(): string {
	const saved = localStorage.getItem(WORKTREE_BRANCH_KEY);
	if (saved?.trim()) {
		return saved;
	}
	const fresh = suggestWorktreeBranch();
	localStorage.setItem(WORKTREE_BRANCH_KEY, fresh);
	return fresh;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
	folder: localStorage.getItem(STORAGE_KEY) ?? null,
	projectIcons: loadIcons(),
	projectNames: loadNames(),
	projectEnvironments: loadProjectEnvironments(),
	activeProjectEnvironments: loadActiveProjectEnvironments(),
	recentFolders: loadRecents(),
	removedProjects: loadRemoved(),
	terminalShell: localStorage.getItem(TERMINAL_SHELL_KEY) ?? "auto",
	worktreeMode: localStorage.getItem(WORKTREE_MODE_KEY) === "true",
	worktreeBranch: loadWorktreeBranch(),

	setFolder: async (path) => {
		// Validate existence via Core (which OWNS the filesystem), not Tauri's fs
		// plugin. The desktop's fs scope is intentionally narrow, so `stat` on an
		// arbitrary project folder is DENIED and throws — which made every caller's
		// `.catch()` fire and wrongly drop the folder. `listDirectory` 404s on a
		// missing/non-directory path; we probe only and never adopt its returned
		// path (old Core hands back a verbatim `\\?\` form we don't want stored).
		// Only for the local node: a remote node's paths don't exist on this
		// machine and the node-side list already validated them when the browser
		// surfaced the path.
		const activeNode = useNodeStore.getState().getActiveNode();
		if (isLocalNode(activeNode)) {
			await listDirectory(
				{ url: activeNode.url, token: activeNode.token ?? null },
				path
			);
		}
		localStorage.setItem(STORAGE_KEY, path);
		set((state) => {
			// Compared by `folderKey`, not raw equality: the same directory reaches
			// this store spelled three different ways (picker, Core, an imported
			// thread's cwd), and raw equality let those pile up as separate recents.
			const deduped = state.recentFolders.filter((p) => !sameFolder(p, path));
			const next = [path, ...deduped].slice(0, MAX_RECENTS);
			saveRecents(next);
			// (Re)importing a folder un-hides it if it was previously removed.
			const removed = state.removedProjects.filter((p) => !sameFolder(p, path));
			if (removed.length !== state.removedProjects.length) {
				saveRemoved(removed);
			}
			return { folder: path, recentFolders: next, removedProjects: removed };
		});
	},

	addProjectFolder: (path) => {
		set((state) => {
			const alreadyKnown = state.recentFolders.some((p) => sameFolder(p, path));
			const wasRemoved = state.removedProjects.some((p) => sameFolder(p, path));
			// Nothing to do if it's already a known, non-removed project.
			if (alreadyKnown && !wasRemoved) {
				return state;
			}
			const next = alreadyKnown
				? state.recentFolders
				: [path, ...state.recentFolders].slice(0, MAX_RECENTS);
			if (!alreadyKnown) {
				saveRecents(next);
			}
			const removed = state.removedProjects.filter((p) => !sameFolder(p, path));
			if (wasRemoved) {
				saveRemoved(removed);
			}
			return { recentFolders: next, removedProjects: removed };
		});
	},

	clearFolder: () => {
		localStorage.removeItem(STORAGE_KEY);
		set({ folder: null });
	},

	setProjectIcon: (path, icon) => {
		set((state) => {
			const next = { ...state.projectIcons, [path]: icon };
			saveIcons(next);
			return { projectIcons: next };
		});
	},

	clearProjectIcon: (path) => {
		set((state) => {
			if (!(path in state.projectIcons)) {
				return state;
			}
			const { [path]: _removed, ...rest } = state.projectIcons;
			saveIcons(rest);
			return { projectIcons: rest };
		});
	},

	setProjectName: (path, name) => {
		const trimmed = name.trim();
		set((state) => {
			if (!trimmed) {
				if (!(path in state.projectNames)) {
					return state;
				}
				const { [path]: _removed, ...rest } = state.projectNames;
				saveNames(rest);
				return { projectNames: rest };
			}
			const next = { ...state.projectNames, [path]: trimmed };
			saveNames(next);
			return { projectNames: next };
		});
	},

	clearProjectName: (path) => {
		set((state) => {
			if (!(path in state.projectNames)) {
				return state;
			}
			const { [path]: _removed, ...rest } = state.projectNames;
			saveNames(rest);
			return { projectNames: rest };
		});
	},

	setProjectEnvironments: (path, environments, activeId) => {
		set((state) => {
			const projectEnvironments = { ...state.projectEnvironments };
			if (environments.length === 0) {
				delete projectEnvironments[path];
			} else {
				projectEnvironments[path] = environments;
			}
			const activeProjectEnvironments = {
				...state.activeProjectEnvironments,
			};
			const resolvedActive =
				activeId &&
				environments.some((environment) => environment.id === activeId)
					? activeId
					: environments[0]?.id;
			if (resolvedActive) {
				activeProjectEnvironments[path] = resolvedActive;
			} else {
				delete activeProjectEnvironments[path];
			}
			localStorage.setItem(
				ENVIRONMENTS_KEY,
				JSON.stringify(projectEnvironments)
			);
			localStorage.setItem(
				ACTIVE_ENVIRONMENTS_KEY,
				JSON.stringify(activeProjectEnvironments)
			);
			return { projectEnvironments, activeProjectEnvironments };
		});
	},

	selectProjectEnvironment: (path, environmentId) => {
		set((state) => {
			if (
				!state.projectEnvironments[path]?.some(
					(environment) => environment.id === environmentId
				)
			) {
				return state;
			}
			const activeProjectEnvironments = {
				...state.activeProjectEnvironments,
				[path]: environmentId,
			};
			localStorage.setItem(
				ACTIVE_ENVIRONMENTS_KEY,
				JSON.stringify(activeProjectEnvironments)
			);
			return { activeProjectEnvironments };
		});
	},

	removeRecentFolder: (path) => {
		set((state) => {
			const next = state.recentFolders.filter((p) => !sameFolder(p, path));
			saveRecents(next);
			const folder =
				state.folder && sameFolder(state.folder, path) ? null : state.folder;
			if (folder === null) {
				localStorage.removeItem(STORAGE_KEY);
			}
			return { recentFolders: next, folder };
		});
	},

	removeProject: (path) => {
		set((state) => {
			const next = state.recentFolders.filter((p) => !sameFolder(p, path));
			saveRecents(next);
			const removed = state.removedProjects.some((p) => sameFolder(p, path))
				? state.removedProjects
				: [...state.removedProjects, path];
			saveRemoved(removed);
			const folder =
				state.folder && sameFolder(state.folder, path) ? null : state.folder;
			if (folder === null) {
				localStorage.removeItem(STORAGE_KEY);
			}
			// Drop any custom icon / display name so a re-imported folder starts
			// fresh and stale data URLs don't linger in localStorage.
			let projectIcons = state.projectIcons;
			if (path in projectIcons) {
				const { [path]: _dropped, ...rest } = projectIcons;
				projectIcons = rest;
				saveIcons(rest);
			}
			let projectNames = state.projectNames;
			if (path in projectNames) {
				const { [path]: _dropped, ...rest } = projectNames;
				projectNames = rest;
				saveNames(rest);
			}
			const projectEnvironments = { ...state.projectEnvironments };
			delete projectEnvironments[path];
			const activeProjectEnvironments = {
				...state.activeProjectEnvironments,
			};
			delete activeProjectEnvironments[path];
			localStorage.setItem(
				ENVIRONMENTS_KEY,
				JSON.stringify(projectEnvironments)
			);
			localStorage.setItem(
				ACTIVE_ENVIRONMENTS_KEY,
				JSON.stringify(activeProjectEnvironments)
			);
			return {
				recentFolders: next,
				removedProjects: removed,
				folder,
				projectIcons,
				projectNames,
				projectEnvironments,
				activeProjectEnvironments,
			};
		});
	},

	setTerminalShell: (shell) => {
		localStorage.setItem(TERMINAL_SHELL_KEY, shell);
		set({ terminalShell: shell });
	},

	setWorktreeMode: (on) => {
		localStorage.setItem(WORKTREE_MODE_KEY, on ? "true" : "false");
		set({ worktreeMode: on });
	},

	setWorktreeBranch: (name) => {
		localStorage.setItem(WORKTREE_BRANCH_KEY, name);
		set({ worktreeBranch: name });
	},

	regenerateWorktreeBranch: () => {
		const next = suggestWorktreeBranch();
		localStorage.setItem(WORKTREE_BRANCH_KEY, next);
		set({ worktreeBranch: next });
	},
}));
