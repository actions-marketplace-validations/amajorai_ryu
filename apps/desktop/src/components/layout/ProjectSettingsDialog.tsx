// Edit a project folder's display name + AGENTS.md instructions. Loads any
// existing AGENTS.md / agents.md / CLAUDE.md from the folder; first save creates
// AGENTS.md when none exists. Uses the same Plate MarkdownEditor as Spaces pages.

import { Button } from "@ryu/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog";
import { Input } from "@ryu/ui/components/input";
import { Label } from "@ryu/ui/components/label";
import { toast } from "@ryu/ui/components/sileo";
import { Spinner } from "@ryu/ui/components/spinner";
import { useEffect, useRef, useState } from "react";
import { MarkdownEditor } from "@/src/components/editor/MarkdownEditor.tsx";
import {
	basename,
	joinPath,
	resolveProjectAgentsFile,
	writeProjectFile,
} from "@/src/lib/files.ts";
import { useWorkspaceStore } from "@/src/store/useWorkspaceStore.ts";

/** Controlled dialog to edit a project's label and on-disk AGENTS.md. */
export function ProjectSettingsDialog({
	path,
	open,
	onOpenChange,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	path: string;
}) {
	const projectNames = useWorkspaceStore((s) => s.projectNames);
	const setProjectName = useWorkspaceStore((s) => s.setProjectName);
	const folderLeaf = basename(path);
	const storedName = projectNames[path];

	const [name, setName] = useState(storedName ?? folderLeaf);
	const [markdown, setMarkdown] = useState<string | null>(null);
	const [fileName, setFileName] = useState("AGENTS.md");
	const [filePath, setFilePath] = useState<string | null>(null);
	const [existed, setExisted] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const markdownRef = useRef("");

	// Reset + load when the dialog opens for a path.
	useEffect(() => {
		if (!open) {
			return;
		}
		const leaf = basename(path);
		const label = useWorkspaceStore.getState().projectNames[path] ?? leaf;
		setName(label);
		setMarkdown(null);
		setLoadError(null);
		setFileName("AGENTS.md");
		setFilePath(null);
		setExisted(false);
		markdownRef.current = "";

		let cancelled = false;
		resolveProjectAgentsFile(path)
			.then((resolved) => {
				if (cancelled) {
					return;
				}
				markdownRef.current = resolved.content;
				setMarkdown(resolved.content);
				setFileName(resolved.fileName);
				setFilePath(resolved.path);
				setExisted(resolved.existed);
			})
			.catch((e) => {
				if (cancelled) {
					return;
				}
				console.error("Failed to load project instructions", e);
				setLoadError(
					"Couldn't read this folder's instruction file. Check the path is reachable."
				);
				setMarkdown("");
				setFilePath(null);
			});
		return () => {
			cancelled = true;
		};
	}, [open, path]);

	const handleSave = async () => {
		if (saving || markdown === null) {
			return;
		}
		const trimmedName = name.trim();
		if (!trimmedName) {
			toast.error("Name can't be empty");
			return;
		}
		const targetPath = filePath ?? joinPath(path, fileName || "AGENTS.md");
		setSaving(true);
		try {
			await writeProjectFile(targetPath, markdownRef.current);
			// Empty / basename-equal clears the override so the leaf stays the source of truth.
			setProjectName(path, trimmedName === folderLeaf ? "" : trimmedName);
			onOpenChange(false);
			toast.success(
				existed ? `Saved ${fileName}` : `Created ${basename(targetPath)}`,
				{
					description: existed
						? "Project instructions updated."
						: "Project instructions file created in this folder.",
				}
			);
		} catch (e) {
			console.error("Failed to save project settings", e);
			toast.error("Couldn't save project settings", {
				description:
					"Something went wrong writing AGENTS.md. Please try again.",
			});
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
				<DialogHeader className="shrink-0 space-y-1.5 border-b px-6 py-4">
					<DialogTitle>Edit project</DialogTitle>
					<DialogDescription>
						Set how this folder appears in the sidebar and the instructions
						agents read from{" "}
						<code className="rounded bg-muted px-1 font-mono text-[11px]">
							{fileName}
						</code>
						.
					</DialogDescription>
				</DialogHeader>

				<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="project-settings-name">Name</Label>
						<Input
							// biome-ignore lint/a11y/noAutofocus: dialog opened by explicit user action
							autoFocus
							disabled={saving}
							id="project-settings-name"
							onChange={(e) => setName(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
									e.preventDefault();
								}
							}}
							placeholder={folderLeaf}
							spellCheck={false}
							value={name}
						/>
						<p className="text-muted-foreground text-xs">
							Shown in the sidebar. The folder path on disk stays the same.
						</p>
					</div>

					<div className="flex min-h-0 flex-col gap-1.5">
						<Label htmlFor="project-settings-instructions">
							Instructions
							{!existed && markdown !== null ? (
								<span className="ml-2 font-normal text-muted-foreground">
									— will create {fileName} on save
								</span>
							) : null}
						</Label>
						{loadError ? (
							<p className="text-destructive text-sm">{loadError}</p>
						) : null}
						{markdown === null ? (
							<div className="flex min-h-48 items-center justify-center rounded-md border">
								<Spinner className="size-5" />
							</div>
						) : (
							<div
								className="overflow-hidden rounded-md border"
								id="project-settings-instructions"
							>
								<MarkdownEditor
									compact
									initialMarkdown={markdown}
									key={`${path}:${filePath ?? "new"}`}
									onChangeMarkdown={(next) => {
										markdownRef.current = next;
									}}
								/>
							</div>
						)}
						<p className="text-muted-foreground text-xs">
							Same editor as Spaces pages. Agents pick up{" "}
							<code className="rounded bg-muted px-1 font-mono text-[11px]">
								AGENTS.md
							</code>{" "}
							(or an existing{" "}
							<code className="rounded bg-muted px-1 font-mono text-[11px]">
								CLAUDE.md
							</code>
							) at the project root.
						</p>
					</div>
				</div>

				<DialogFooter className="shrink-0 border-t px-6 py-4">
					<Button
						disabled={saving}
						onClick={() => onOpenChange(false)}
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
					<Button
						disabled={saving || markdown === null || name.trim().length === 0}
						onClick={() => {
							handleSave().catch(() => undefined);
						}}
						type="button"
					>
						{saving ? <Spinner className="size-4" /> : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
