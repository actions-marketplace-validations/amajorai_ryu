// apps/desktop/src/components/spaces/AddToSpaceDialog.tsx
//
// "Add to <space>" — the dialog behind the sidebar row's hover "+" and the create
// menu's "Upload files" row. One surface for the three ways something enters a
// Space: upload a file, start a page, start a database.
//
// ## Why the upload half reports an outcome and not just a tick
//
// `POST /api/spaces/:id/files` stores the bytes AND runs extraction, then reports
// what extraction managed in `index`. A 200 therefore means "stored", not
// "searchable" — a scanned PDF on a node with no OCR reader comes back `skipped`,
// and a user told "Uploaded ✓" would go on to search for text that was never
// indexed. Every finished row prints {@link indexNote} for that reason.
//
// Uploads run one at a time. The wire form is base64 JSON at up to 32 MiB a file,
// so N concurrent uploads means N inflated copies resident at once; serialising
// costs wall-clock on a big batch and bounds memory, which is the better trade for
// a dialog someone drags a folder into.

import { Database01Icon, StickyNote01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@ryu/ui/components/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog.tsx";
import {
	FileUpload,
	type FileUploadItem,
} from "@ryu/ui/components/file-upload.tsx";
import { Label } from "@ryu/ui/components/label.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select.tsx";
import { toast } from "@ryu/ui/components/sileo.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSpacesContext } from "@/src/contexts/SpacesContext.tsx";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import {
	formatBytes,
	SPACE_UPLOAD_MAX_BYTES,
	type SpaceFileIndex,
} from "@/src/lib/api/spaces.ts";

/** The system space every other upload path in the app already writes to, and so
 *  the least surprising default when the dialog is opened without a target. */
const DEFAULT_SPACE_NAME = "Uploads";

/**
 * The one-line truth about a stored file's contents, per Core's extraction state.
 *
 * The five states are three different things for the user to do (nothing / install
 * a reader / try again), which is exactly why this does not collapse them into a
 * single "Uploaded". `null` — a state this build does not recognise — says only
 * that the bytes are stored, because a claim about searchability has no safe
 * default.
 */
function indexNote(index: SpaceFileIndex): string {
	switch (index.state) {
		case "indexed":
			return "Stored and searchable";
		case "pending":
			return "Stored — reading its text now";
		case "skipped":
			return "Stored — nothing on this node can read this format, so its contents aren't searchable";
		case "failed":
			return index.message
				? `Stored, but its text couldn't be read: ${index.message}`
				: "Stored, but its text couldn't be read";
		case "unattempted":
			return "Stored — its contents haven't been indexed";
		default:
			return "Stored";
	}
}

interface QueuedUpload extends FileUploadItem {
	file: File;
}

export function AddToSpaceDialog({
	onClose,
	open,
	spaceId,
}: {
	onClose: () => void;
	open: boolean;
	/** The Space to add to. `null` opens the dialog with a picker instead — the
	 *  create-menu entry point, which has no row to infer a target from. */
	spaceId: string | null;
}) {
	const { openTab } = useTabsContext();
	const { spaces, uploadFile, createPage, createDatabase, reload } =
		useSpacesContext();
	const [pickedId, setPickedId] = useState<string | null>(null);
	const [queue, setQueue] = useState<QueuedUpload[]>([]);
	const [creating, setCreating] = useState(false);
	// Uploads are serialised by chaining onto this promise, so a second drop while
	// the first batch is still running queues behind it rather than racing it.
	const chainRef = useRef<Promise<void>>(Promise.resolve());
	const seqRef = useRef(0);

	const fallbackId = useMemo(() => {
		const uploads = spaces.find(
			(s) => s.name.toLowerCase() === DEFAULT_SPACE_NAME.toLowerCase()
		);
		return uploads?.id ?? spaces[0]?.id ?? null;
	}, [spaces]);

	const targetId = spaceId ?? pickedId ?? fallbackId;
	const target = spaces.find((s) => s.id === targetId) ?? null;

	// A fresh open starts from an empty queue: leaving the previous batch's rows up
	// would show results for a Space the user may no longer be looking at.
	useEffect(() => {
		if (open) {
			setQueue([]);
			setPickedId(null);
		}
	}, [open]);

	const patch = useCallback((id: string, next: Partial<QueuedUpload>) => {
		setQueue((prev) =>
			prev.map((item) => (item.id === id ? { ...item, ...next } : item))
		);
	}, []);

	const runOne = useCallback(
		async (entry: QueuedUpload, toSpaceId: string) => {
			// `progress: null` until the first real `onprogress`: the file is being
			// read into base64 locally and there is nothing truthful to show yet.
			patch(entry.id, {
				status: "uploading",
				progress: null,
				error: undefined,
			});
			try {
				const stored = await uploadFile(toSpaceId, entry.file, {
					onProgress: (fraction) => patch(entry.id, { progress: fraction }),
				});
				patch(entry.id, {
					status: "success",
					progress: 1,
					note: indexNote(stored.index),
				});
			} catch (e) {
				patch(entry.id, {
					status: "error",
					progress: null,
					error: e instanceof Error ? e.message : "Upload failed",
				});
			}
		},
		[patch, uploadFile]
	);

	const enqueue = useCallback(
		(entries: QueuedUpload[], toSpaceId: string) => {
			chainRef.current = chainRef.current.then(async () => {
				for (const entry of entries) {
					await runOne(entry, toSpaceId);
				}
				// One refetch per batch, not per file — the list only needs to be right
				// once the queue settles, and reloading mid-batch re-renders the sidebar
				// under the user's pointer.
				await reload().catch(() => undefined);
			});
		},
		[runOne, reload]
	);

	const onFilesAdded = (files: File[]) => {
		if (!targetId) {
			toast.error("Create a space first", {
				description: "There's nowhere to put these files yet.",
			});
			return;
		}
		const entries: QueuedUpload[] = files.map((file) => {
			seqRef.current += 1;
			return {
				file,
				id: `${seqRef.current}:${file.name}`,
				name: file.name,
				size: file.size,
				status: "pending",
				progress: null,
			};
		});
		// Refuse the oversize ones up front, as rows rather than as a toast, so the
		// user sees which file was refused next to the ones that were not.
		const tooBig = entries.filter((e) => e.file.size > SPACE_UPLOAD_MAX_BYTES);
		const ok = entries.filter((e) => e.file.size <= SPACE_UPLOAD_MAX_BYTES);
		setQueue((prev) => [
			...prev,
			...ok,
			...tooBig.map((e) => ({
				...e,
				status: "error" as const,
				error: `Too large — the limit is ${formatBytes(SPACE_UPLOAD_MAX_BYTES)}.`,
			})),
		]);
		if (ok.length > 0) {
			enqueue(ok, targetId);
		}
	};

	const onRetry = (item: FileUploadItem) => {
		const entry = queue.find((q) => q.id === item.id);
		if (!(entry && targetId)) {
			return;
		}
		enqueue([entry], targetId);
	};

	const onRemove = (item: FileUploadItem) => {
		setQueue((prev) => prev.filter((q) => q.id !== item.id));
	};

	const createAndOpen = async (kind: "database" | "page") => {
		if (!targetId) {
			return;
		}
		setCreating(true);
		try {
			const id =
				kind === "page"
					? await createPage(targetId, "Untitled")
					: await createDatabase(targetId, "Untitled");
			openTab(`/spaces/${targetId}/${kind === "page" ? "doc" : "db"}/${id}`, {
				title: "Untitled",
			});
			onClose();
		} catch {
			toast.error(
				kind === "page"
					? "Couldn't create the page"
					: "Couldn't create the database"
			);
		} finally {
			setCreating(false);
		}
	};

	const uploading = queue.some((q) => q.status === "uploading");

	return (
		<Dialog
			onOpenChange={(next: boolean) => {
				if (!next) {
					onClose();
				}
			}}
			open={open}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{target ? `Add to ${target.name}` : "Add to a space"}
					</DialogTitle>
					<DialogDescription>
						Upload files, or start a new page or database in this space.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-4 py-4">
					{spaceId === null && (
						<div className="flex flex-col gap-1.5">
							<Label>Space</Label>
							<Select
								items={spaces.map((s) => ({ label: s.name, value: s.id }))}
								onValueChange={(value: string) => setPickedId(value)}
								value={targetId ?? ""}
							>
								<SelectTrigger className="h-9 w-full text-sm">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{spaces.map((s) => (
										<SelectItem key={s.id} value={s.id}>
											{s.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
					<FileUpload
						disabled={!targetId}
						items={queue}
						onFilesAdded={onFilesAdded}
						onRemove={onRemove}
						onRetry={onRetry}
						title="Drop files here"
					/>
					<div className="flex flex-col gap-2">
						<Label>Or start something new</Label>
						<div className="flex gap-2">
							<Button
								className="flex-1"
								disabled={creating || !targetId}
								onClick={() => {
									void createAndOpen("page");
								}}
								type="button"
								variant="ghost"
							>
								<HugeiconsIcon className="size-4" icon={StickyNote01Icon} />
								New page
							</Button>
							<Button
								className="flex-1"
								disabled={creating || !targetId}
								onClick={() => {
									void createAndOpen("database");
								}}
								type="button"
								variant="ghost"
							>
								<HugeiconsIcon className="size-4" icon={Database01Icon} />
								New database
							</Button>
						</div>
					</div>
				</div>
				<DialogFooter>
					<Button onClick={onClose} type="button" variant="ghost">
						{/* Closing mid-upload does not cancel it — the transfer is owned by
						    the promise chain, not by this dialog's mount. Say so rather than
						    implying a cancel this button does not perform. */}
						{uploading ? "Close (uploads continue)" : "Done"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
