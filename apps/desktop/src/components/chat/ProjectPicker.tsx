"use client";

import {
	Add01Icon,
	Cancel01Icon,
	Folder03Icon,
	FolderAddIcon,
	Search01Icon,
	Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, ButtonLabel } from "@ryu/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@ryu/ui/components/dropdown-menu";
import { Input } from "@ryu/ui/components/input";
import { cn } from "@ryu/ui/lib/utils";
import { useCallback, useState } from "react";
import {
	COMPOSER_SELECT_ITEM,
	WORKSPACE_MENU_CONTENT,
	WORKSPACE_SELECT_TRIGGER,
} from "@/components/agent-elements/input/composer-select.ts";
import { ProjectGlyph } from "@/src/components/layout/ProjectIconDialog.tsx";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { createProjectFolder } from "@/src/lib/api/workspace.ts";
import { sameFolder } from "@/src/lib/folder-path.ts";
import {
	findWorkspaceProject,
	workspaceProjectName,
} from "@/src/lib/workspace-projects.ts";
import { useWorkspaceStore } from "@/src/store/useWorkspaceStore.ts";
import { NodeFolderBrowser } from "./NodeFolderBrowser.tsx";

const PATH_SEP = /[\\/]/;

export function ProjectPicker({
	onFolderSelected,
}: {
	onFolderSelected?: (folder: string) => void;
} = {}) {
	const { folder, projectNames, projects, setFolder } = useWorkspaceStore();
	const [menuOpen, setMenuOpen] = useState(false);
	// The create-folder and browse dialogs live OUTSIDE the menu so they survive
	// the menu closing on select (a dialog nested in the menu would unmount with it).
	const [createOpen, setCreateOpen] = useState(false);
	const [browseOpen, setBrowseOpen] = useState(false);

	const handleSelectBrowsed = useCallback(
		(selected: string) => {
			// Browsed paths come from Core's own listing, so activation should
			// succeed; on a transient failure keep the current folder rather than
			// clearing it out from under the user.
			void setFolder(selected)
				.then(() => onFolderSelected?.(selected))
				.catch(() => {
					// no-op
				});
		},
		[onFolderSelected, setFolder]
	);

	const activeProject = folder
		? findWorkspaceProject(projects, folder)
		: undefined;
	const folderName = activeProject
		? workspaceProjectName(activeProject, projectNames)
		: folder
			? projectNames[folder]?.trim() || folder.split(PATH_SEP).at(-1) || null
			: null;

	return (
		<>
			<DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label="Select project folder"
							className={WORKSPACE_SELECT_TRIGGER}
							size="sm"
							title={folder ?? "Pick a project folder"}
							type="button"
							variant="ghost"
						/>
					}
				>
					<HugeiconsIcon className="size-3.5 shrink-0" icon={Folder03Icon} />
					<ButtonLabel className="max-w-32">
						{folderName ?? "Project"}
					</ButtonLabel>
				</DropdownMenuTrigger>

				<DropdownMenuContent
					align="start"
					className={cn(WORKSPACE_MENU_CONTENT, "max-h-[60vh] overflow-y-auto")}
					side="top"
					sideOffset={6}
				>
					<ProjectPickerContent
						onBrowse={() => {
							setMenuOpen(false);
							setBrowseOpen(true);
						}}
						onClose={() => setMenuOpen(false)}
						onFolderSelected={onFolderSelected}
						onStartFromScratch={() => {
							setMenuOpen(false);
							setCreateOpen(true);
						}}
					/>
				</DropdownMenuContent>
			</DropdownMenu>
			<CreateFolderDialog
				onFolderSelected={onFolderSelected}
				onOpenChange={setCreateOpen}
				open={createOpen}
			/>
			<NodeFolderBrowser
				onOpenChange={setBrowseOpen}
				onSelect={handleSelectBrowsed}
				open={browseOpen}
			/>
		</>
	);
}

/** The folder-selector body (recents + browse + clear), reusable under any menu
 *  trigger (the standalone picker and WorkspacePicker's Folder submenu both mount
 *  it inside a dropdown-menu). Reads/writes the shared workspace store directly. */
export function ProjectPickerContent({
	onClose,
	onStartFromScratch,
	onBrowse,
	onFolderSelected,
}: {
	onClose: () => void;
	onFolderSelected?: (folder: string) => void;
	/** Opens the create-folder dialog (owned by the persistent parent, so it
	 *  survives this menu closing). Omit to hide the "New project" submenu (e.g.
	 *  the empty-state popover offers recents only). */
	onStartFromScratch?: () => void;
	/** Opens the node-aware folder browser (owned by the persistent parent, so it
	 *  survives this menu closing). Replaces the native OS picker, which only sees
	 *  the desktop host and not a remote node. Omit to hide the "New project"
	 *  submenu. */
	onBrowse?: () => void;
}) {
	const {
		folder,
		projectIcons,
		projectNames,
		projects,
		setFolder,
		removeProject,
		clearFolder,
	} = useWorkspaceStore();

	const [recentQuery, setRecentQuery] = useState("");

	const handleBrowse = useCallback(() => {
		onClose();
		onBrowse?.();
	}, [onBrowse, onClose]);

	const handleSelectRecent = useCallback(
		async (path: string) => {
			onClose();
			// Selecting must never REMOVE the folder: removal is the X button's job
			// only. If activation fails (e.g. the folder is gone), leave the row be.
			try {
				await setFolder(path);
				onFolderSelected?.(path);
			} catch {
				// no-op: keep the recent; the user removes it explicitly via the X.
			}
		},
		[onFolderSelected, setFolder, onClose]
	);

	// Removing here uses removeProject (not just removeRecentFolder) so the folder
	// also disappears from the sidebar's Projects section and stays gone even if it
	// still has conversations — both surfaces read the same store.
	const handleRemoveProject = useCallback(
		(e: React.MouseEvent, projectId: string) => {
			e.stopPropagation();
			removeProject(projectId);
		},
		[removeProject]
	);

	const hasProjects = projects.length > 0;
	const rq = recentQuery.trim().toLowerCase();
	const filteredProjects = rq
		? projects.filter((project) => {
				const name = workspaceProjectName(project, projectNames).toLowerCase();
				return (
					name.includes(rq) ||
					project.folders.some((path) => path.toLowerCase().includes(rq))
				);
			})
		: projects;

	return (
		<>
			{hasProjects && (
				<>
					<div className="sticky top-0 z-10 mb-1">
						<div className="relative">
							<HugeiconsIcon
								className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
								icon={Search01Icon}
							/>
							<Input
								className="h-7 border-0 bg-transparent pl-7 text-[12px]"
								onChange={(e) => setRecentQuery(e.target.value)}
								onKeyDown={(e) => e.stopPropagation()}
								placeholder="Search projects"
								spellCheck={false}
								value={recentQuery}
							/>
						</div>
					</div>
					{filteredProjects.length === 0 ? (
						<p className="px-2 py-1.5 text-muted-foreground text-sm">
							No matching projects.
						</p>
					) : (
						filteredProjects.map((project) => {
							const name = workspaceProjectName(project, projectNames);
							const primary = project.folders[0];
							const isActive = project.folders.some(
								(path) => folder !== null && sameFolder(path, folder)
							);
							return (
								<div
									className={cn(
										"group/recent relative flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-foreground/10",
										isActive && "bg-foreground/10"
									)}
									key={project.id}
								>
									{/* Full-row overlay: clicking the row opens/sets this folder. */}
									<button
										aria-label={`Open ${name}`}
										className="absolute inset-0 cursor-pointer rounded-lg"
										disabled={!primary}
										onClick={() => {
											if (primary) {
												handleSelectRecent(primary).catch(() => undefined);
											}
										}}
										type="button"
									/>

									<span className="pointer-events-none relative shrink-0 text-foreground/40">
										<ProjectGlyph
											fallback={
												<HugeiconsIcon className="size-4" icon={Folder03Icon} />
											}
											icon={primary ? projectIcons[primary] : undefined}
											size={16}
										/>
									</span>

									<div className="pointer-events-none relative min-w-0 flex-1">
										<div className="truncate font-medium text-foreground/80">
											{name}
										</div>
										{project.folders.map((source) => (
											<div
												className="truncate font-mono text-[10px] text-muted-foreground"
												key={source}
												title={source}
											>
												{source}
											</div>
										))}
									</div>

									{/* Right slot: active dot at rest, remove X on hover. */}
									<div className="relative z-10 size-4 shrink-0">
										{isActive && (
											<HugeiconsIcon
												className="pointer-events-none absolute inset-0 m-auto size-4 text-foreground/70 transition-opacity duration-150 group-hover/recent:opacity-0"
												icon={Tick02Icon}
												strokeWidth={2}
											/>
										)}
										<button
											aria-label={`Remove ${name} from projects`}
											className="pointer-events-none absolute inset-0 flex cursor-pointer items-center justify-center opacity-0 transition-opacity duration-150 group-hover/recent:pointer-events-auto group-hover/recent:opacity-100"
											onClick={(e) => handleRemoveProject(e, project.id)}
											type="button"
										>
											<HugeiconsIcon
												className="size-4 text-foreground/50"
												icon={Cancel01Icon}
											/>
										</button>
									</div>
								</div>
							);
						})
					)}
				</>
			)}

			{hasProjects && <DropdownMenuSeparator />}

			{/* Project creation stays flat: both actions are reachable in one click from
			    this menu, with no flyout nested inside the project picker. */}
			{(onBrowse || onStartFromScratch) && (
				<>
					{onBrowse && (
						<DropdownMenuItem onClick={handleBrowse}>
							<HugeiconsIcon
								className="size-4 shrink-0 text-foreground/40"
								icon={FolderAddIcon}
							/>
							New project
						</DropdownMenuItem>
					)}
					{onStartFromScratch && (
						<DropdownMenuItem onClick={onStartFromScratch}>
							<HugeiconsIcon
								className="size-4 shrink-0 text-foreground/40"
								icon={Add01Icon}
							/>
							Start from scratch
						</DropdownMenuItem>
					)}
				</>
			)}

			{folder && (
				<button
					className={cn(
						COMPOSER_SELECT_ITEM,
						"flex cursor-pointer text-foreground/70 transition-colors hover:bg-foreground/10"
					)}
					onClick={() => {
						onClose();
						clearFolder();
					}}
					type="button"
				>
					<HugeiconsIcon
						className="size-4 shrink-0 text-foreground/40"
						icon={Cancel01Icon}
					/>
					Do not work in a project
				</button>
			)}
		</>
	);
}

/** Dialog to name and create a fresh project folder under Documents/Ryu, then open
 *  it. Controlled + rendered by the persistent picker parent (ProjectPicker /
 *  WorkspacePicker) so it outlives the dropdown menu that launches it. */
export function CreateFolderDialog({
	open: dialogOpen,
	onOpenChange,
	onFolderSelected,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onFolderSelected?: (folder: string) => void;
}) {
	const { setFolder } = useWorkspaceStore();
	const activeNode = useActiveNode();
	const [name, setName] = useState("");
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleCreate = useCallback(async () => {
		const trimmed = name.trim();
		if (!trimmed || creating) {
			return;
		}
		setCreating(true);
		setError(null);
		const result = await createProjectFolder(
			{ url: activeNode.url, token: activeNode.token ?? null },
			trimmed
		);
		setCreating(false);
		if (result.path) {
			const created = result.path;
			setName("");
			onOpenChange(false);
			try {
				await setFolder(created);
				onFolderSelected?.(created);
			} catch {
				setError("Created the folder, but could not open it");
			}
		} else {
			setError(result.error ?? "Could not create the folder");
		}
	}, [
		name,
		creating,
		activeNode.url,
		activeNode.token,
		setFolder,
		onOpenChange,
		onFolderSelected,
	]);

	return (
		<Dialog onOpenChange={onOpenChange} open={dialogOpen}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Start from scratch</DialogTitle>
					<DialogDescription>
						Create a new project folder in Documents/Ryu.
					</DialogDescription>
				</DialogHeader>
				<Input
					// biome-ignore lint/a11y/noAutofocus: dialog opened by explicit user action; focusing the sole field is expected
					autoFocus
					disabled={creating}
					onChange={(e) => {
						setName(e.target.value);
						setError(null);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							handleCreate();
						}
					}}
					placeholder="New project name"
					spellCheck={false}
					value={name}
				/>
				{error && <p className="text-[12px] text-destructive">{error}</p>}
				<DialogFooter>
					<DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
					<Button
						disabled={name.trim().length === 0}
						loading={creating}
						onClick={handleCreate}
						type="button"
					>
						Create project
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
