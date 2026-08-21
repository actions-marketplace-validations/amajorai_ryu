import { dedupeFolders, folderKey, sameFolder } from "./folder-path.ts";

/** A desktop-local project that can expose more than one source folder. */
export interface WorkspaceProject {
	folders: string[];
	id: string;
	/** Omitted when the project should use its primary folder's basename. */
	name?: string;
}

/** Stable legacy-compatible id for a project created from one folder. */
export function projectIdForFolder(path: string): string {
	return `folder:${encodeURIComponent(folderKey(path))}`;
}

/** The first source is the project cwd and remains the primary source. */
export function primaryProjectFolder(project: WorkspaceProject): string | null {
	return project.folders[0] ?? null;
}

/** Move an existing source folder to the front of the project order. */
export function promoteProjectFolder(
	folders: readonly string[],
	folder: string
): string[] {
	const index = folders.findIndex((candidate) => sameFolder(candidate, folder));
	if (index <= 0) {
		return [...folders];
	}
	return [
		folders[index],
		...folders.slice(0, index),
		...folders.slice(index + 1),
	];
}

/** Resolve a project by id or by any of its source folders. */
export function findWorkspaceProject(
	projects: readonly WorkspaceProject[],
	ref: string
): WorkspaceProject | undefined {
	return projects.find(
		(project) =>
			project.id === ref ||
			project.folders.some((path) => sameFolder(path, ref))
	);
}

/** Normalize persisted data without allowing duplicate or empty roots. */
export function normalizeWorkspaceProjects(
	raw: unknown,
	fallbackFolders: readonly string[] = []
): WorkspaceProject[] {
	const projects: WorkspaceProject[] = [];
	if (Array.isArray(raw)) {
		for (const value of raw) {
			if (!(value && typeof value === "object")) {
				continue;
			}
			const record = value as Record<string, unknown>;
			const folders = Array.isArray(record.folders)
				? dedupeFolders(
						record.folders.filter(
							(folder): folder is string =>
								typeof folder === "string" && folder.trim().length > 0
						)
					)
				: [];
			if (
				folders.length === 0 &&
				!(typeof record.id === "string" && record.id.trim())
			) {
				continue;
			}
			const id =
				typeof record.id === "string" && record.id.trim()
					? record.id.trim()
					: projectIdForFolder(folders[0]);
			const name =
				typeof record.name === "string" && record.name.trim()
					? record.name.trim()
					: undefined;
			projects.push({ id, folders, ...(name ? { name } : {}) });
		}
	}

	for (const folder of fallbackFolders) {
		if (
			folder.trim() &&
			!projects.some((project) =>
				project.folders.some((path) => sameFolder(path, folder))
			)
		) {
			projects.push({ folders: [folder], id: projectIdForFolder(folder) });
		}
	}

	return projects;
}

/** User-facing name with the legacy path-keyed name map as a migration fallback. */
export function workspaceProjectName(
	project: WorkspaceProject,
	legacyNames: Readonly<Record<string, string>> = {}
): string {
	const primary = primaryProjectFolder(project);
	const trimmedPrimary = primary?.replace(/[\\/]+$/, "") || primary;
	const legacyName = primary
		? Object.entries(legacyNames).find(([path]) =>
				sameFolder(path, primary)
			)?.[1]
		: undefined;
	return (
		project.name?.trim() ||
		legacyName?.trim() ||
		(trimmedPrimary?.split(/[\\/]/).at(-1) ?? "Project")
	);
}
