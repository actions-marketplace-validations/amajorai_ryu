// Storage settings tab: view + relocate the Ryu data folder, and back it up /
// restore it. All path logic lives in Core (`crate::data_path`); this tab reads
// the state, validates a target, and triggers either a point-only switch (Core
// API) or a copy-migrate / import (offline `ryu-core data-path` subcommand
// orchestrated by the `migrate_data_folder` / `import_data_folder` Tauri
// commands, which restart the app to apply).

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@ryu/ui/components/alert-dialog";
import { Button } from "@ryu/ui/components/button";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { sileo } from "sileo";
import {
	SettingsCard,
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "@/src/components/settings/shared/settings-items.tsx";
import { useActiveNodeGetter } from "@/src/hooks/useActiveNode.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	type DataPathInfo,
	exportDataPath,
	getDataPath,
	resetDataPath,
	switchDataPath,
	type ValidateResult,
	validateDataPath,
} from "@/src/lib/api/data-path.ts";
import {
	fetchParseCapability,
	type ParseCapability,
} from "@/src/lib/api/documents.ts";
import { formatBytes, NODE_UPLOAD_MAX_BYTES } from "@/src/lib/api/spaces.ts";

/** Profiles a copy can target.
 *
 *  Mirrors the non-release rows of `PROFILE_PORT_OFFSETS`
 *  (apps/core/src/profile.rs) — the profiles that have their own port offset, data
 *  dir and keychain slot. `release` is deliberately absent: copying INTO your
 *  primary profile is a restore, which belongs to Backup & restore where it is
 *  guarded accordingly. */
const PROFILE_COPY_TARGETS = ["dev", "canary", "nightly", "beta"] as const;

function humanBytes(n: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let v = n;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i += 1;
	}
	return `${v.toFixed(1)} ${units[i]}`;
}

interface PickedTarget {
	path: string;
	validation: ValidateResult;
}

/**
 * The node's upload ceiling. Read-only, and read FROM THE NODE.
 *
 * It lives on the Storage tab because it is a fact about what this machine will
 * accept onto its own disk — the same subject as the data folder above it. It
 * used to be a card on a separate "Document parsing" tab, which also carried a
 * second copy of the `document.parse` provider picker; that picker is the node
 * dropdown's Toolkits row, the same generic surface every other swappable
 * capability (`web.extract`, `web.search`, …) is bound from, so the duplicate
 * went and this row moved here.
 *
 * ## The number this must not print
 *
 * It once printed `MAX_FILE_BYTES` (200 MiB) as "Maximum file in a Space", a
 * promise the node would not keep twice over: that constant named a route no
 * surface in this app calls, and the route could not have honoured it anyway
 * (registered with no `DefaultBodyLimit`, so axum's implicit 2 MiB cut in first —
 * and its body is base64, so the true ceiling was ~1.5 MiB of file). Every upload
 * a user can perform — chat attachment, editor paste, `ui.uploadFile` — goes to
 * `POST /api/uploads` and stops at {@link NODE_UPLOAD_MAX_BYTES}, 32 MiB.
 *
 * Core has since converged the two (`MAX_FILE_BYTES = uploads::MAX_UPLOAD_BYTES`,
 * and `/api/spaces/:id/files` now layers `SPACE_FILE_BODY_LIMIT`), so every
 * reachable route stops at the same number. That is a reason this row is no
 * longer WRONG, not a reason to hardcode it: it converged once and could diverge
 * again, and a row that reads the node cannot be wrong the next time it moves.
 * So the constant is the fallback for a failed read ONLY, and the row says so
 * when it is used.
 */
function UploadCeilingSection() {
	const getNode = useActiveNodeGetter();
	const [capability, setCapability] = useState<ParseCapability | null>(null);

	useEffect(() => {
		let cancelled = false;
		// Failure-tolerant: this probes the bound parse sidecar (2s budget, and it
		// never wakes a sleeping one), so it is allowed to come back empty without
		// taking the Storage tab down with it.
		fetchParseCapability(toTarget(getNode()))
			.then((next) => {
				if (!cancelled) {
					setCapability(next);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setCapability(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [getNode]);

	const reported = capability?.maxInputBytes ?? 0;
	const limit = reported > 0 ? reported : NODE_UPLOAD_MAX_BYTES;

	return (
		<SettingsSection
			caption="What this node accepts onto its disk. Files are kept as content-addressed blobs inside the data folder above."
			title="Upload limits"
		>
			<SettingsGroup>
				<SettingsItem
					actions={
						<span className="text-foreground text-sm">
							{formatBytes(limit)}
						</span>
					}
					description={
						reported > 0
							? "Reported by this node. Chat attachments, files added to a Space and images pasted into a page all go through the same upload route, and the document parser accepts the same size, so one number governs all of them."
							: "This node did not report its limit, so this is the desktop's built-in default; the real ceiling may differ."
					}
					title="Maximum file you can upload"
				/>
			</SettingsGroup>
		</SettingsSection>
	);
}

interface ProgressState {
	copied: number;
	phase: string;
	total: number;
}

export function StorageSettings() {
	const getNode = useActiveNodeGetter();
	const [info, setInfo] = useState<DataPathInfo | null>(null);
	const [picked, setPicked] = useState<PickedTarget | null>(null);
	const [busy, setBusy] = useState(false);
	const [pendingProfileCopy, setPendingProfileCopy] = useState<string | null>(
		null
	);
	const [progress, setProgress] = useState<ProgressState | null>(null);
	const [pendingRestore, setPendingRestore] = useState<string | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);

	const refresh = useCallback(() => {
		setLoadFailed(false);
		getDataPath(toTarget(getNode()))
			.then((next) => {
				setInfo(next);
				setLoadFailed(false);
			})
			.catch(() => {
				setInfo(null);
				setLoadFailed(true);
			});
	}, [getNode]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	// Stream copy/extract progress from the offline subcommand.
	useEffect(() => {
		const unlisten = listen<{
			phase: string;
			copied_bytes: number;
			total_bytes: number;
		}>("data-folder-progress", (event) => {
			setProgress({
				phase: event.payload.phase,
				copied: event.payload.copied_bytes,
				total: event.payload.total_bytes,
			});
		});
		return () => {
			unlisten.then((fn) => fn()).catch(() => undefined);
		};
	}, []);

	const pickFolder = useCallback(async () => {
		const selected = await open({ directory: true, multiple: false });
		if (typeof selected !== "string") {
			return;
		}
		const validation = await validateDataPath(toTarget(getNode()), selected);
		setPicked({ path: selected, validation });
	}, [getNode]);

	const doMigrate = useCallback(async () => {
		if (!picked) {
			return;
		}
		setBusy(true);
		setProgress({
			phase: "copy",
			copied: 0,
			total: picked.validation.source_size_bytes,
		});
		try {
			// Resolves only on failure — on success the app restarts.
			await invoke("migrate_data_folder", {
				to: picked.path,
				moveSource: false,
			});
		} catch (e) {
			setBusy(false);
			setProgress(null);
			sileo.error({ title: "Relocation failed", description: String(e) });
		}
	}, [picked]);

	const doSwitch = useCallback(async () => {
		if (!picked) {
			return;
		}
		setBusy(true);
		try {
			const res = await switchDataPath(toTarget(getNode()), picked.path);
			if (!res.ok) {
				throw new Error(res.error ?? "switch failed");
			}
			await relaunch();
		} catch (e) {
			setBusy(false);
			sileo.error({ title: "Could not switch folder", description: String(e) });
		}
	}, [getNode, picked]);

	const doReset = useCallback(async () => {
		setBusy(true);
		try {
			const res = await resetDataPath(toTarget(getNode()));
			if (!res.ok) {
				throw new Error(res.error ?? "reset failed");
			}
			await relaunch();
		} catch (e) {
			setBusy(false);
			sileo.error({ title: "Could not reset folder", description: String(e) });
		}
	}, [getNode]);

	const doProfileCopy = useCallback(async (toProfile: string) => {
		setBusy(true);
		try {
			// Core is stopped by the Tauri command before anything is copied (every
			// store runs in WAL mode, so a live copy captures a torn snapshot), and the
			// master key is moved BEFORE any file is written — a failure there aborts
			// with nothing copied rather than leaving unreadable ciphertext behind.
			await invoke("copy_data_folder_to_profile", { toProfile });
			sileo.success(`Copied to the ${toProfile} profile`, {
				description:
					"Start Ryu on that profile to use it. This profile is unchanged.",
			});
		} catch (e) {
			sileo.error("Could not copy to that profile", {
				description: String(e),
			});
		} finally {
			setBusy(false);
			setPendingProfileCopy(null);
		}
	}, []);

	const doExport = useCallback(async () => {
		const dest = await save({
			defaultPath: "ryu-data-backup.zip",
			filters: [{ name: "Zip archive", extensions: ["zip"] }],
		});
		if (!dest) {
			return;
		}
		setBusy(true);
		try {
			const res = await exportDataPath(toTarget(getNode()), dest);
			if (!res.ok) {
				throw new Error(res.error ?? "export failed");
			}
			sileo.success({
				title: "Backup created",
				description: `${humanBytes(res.bytes ?? 0)} written to ${dest}`,
			});
		} catch (e) {
			sileo.error({ title: "Backup failed", description: String(e) });
		} finally {
			setBusy(false);
		}
	}, [getNode]);

	const doImport = useCallback(async () => {
		const archive = await open({
			multiple: false,
			filters: [{ name: "Zip archive", extensions: ["zip"] }],
		});
		if (typeof archive !== "string") {
			return;
		}
		// Confirm before wiping current data — the actual restore runs in runImport.
		setPendingRestore(archive);
	}, []);

	const runImport = useCallback(async () => {
		if (!pendingRestore) {
			return;
		}
		const archive = pendingRestore;
		setPendingRestore(null);
		setBusy(true);
		setProgress({ phase: "extract", copied: 0, total: 0 });
		try {
			// Resolves only on failure — on success the app restarts.
			await invoke("import_data_folder", { archive });
		} catch (e) {
			setBusy(false);
			setProgress(null);
			sileo.error({ title: "Restore failed", description: String(e) });
		}
	}, [pendingRestore]);

	const progressPct =
		progress && progress.total > 0
			? Math.min(100, Math.round((progress.copied / progress.total) * 100))
			: null;

	let changeLocationBody: ReactNode;
	if (progress) {
		changeLocationBody = (
			<div className="flex flex-col gap-1.5">
				<div className="text-muted-foreground text-xs">
					{progress.phase === "extract" ? "Restoring" : "Copying"}…
					{progressPct === null ? "" : ` ${progressPct}%`}
				</div>
				<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
					<div
						className="h-full bg-primary transition-all"
						style={{ width: `${progressPct ?? 10}%` }}
					/>
				</div>
				<div className="text-muted-foreground text-xs">
					The app will restart automatically when finished.
				</div>
			</div>
		);
	} else if (picked) {
		changeLocationBody = (
			<div className="flex flex-col gap-3">
				<div className="break-all text-sm">{picked.path}</div>
				{picked.validation.ok ? (
					<div className="text-muted-foreground text-xs">
						{humanBytes(picked.validation.source_size_bytes)} to copy ·{" "}
						{humanBytes(picked.validation.target_free_bytes)} free at target
					</div>
				) : (
					<div className="text-destructive text-xs">
						{picked.validation.error}
					</div>
				)}
				<div className="flex flex-wrap gap-2">
					<Button
						disabled={busy || !picked.validation.ok}
						onClick={() => {
							doMigrate().catch(() => undefined);
						}}
						size="sm"
					>
						Copy data &amp; restart
					</Button>
					<Button
						disabled={busy || !picked.validation.ok}
						onClick={() => {
							doSwitch().catch(() => undefined);
						}}
						size="sm"
						variant="outline"
					>
						Start fresh here
					</Button>
					<Button
						disabled={busy}
						onClick={() => setPicked(null)}
						size="sm"
						variant="ghost"
					>
						Cancel
					</Button>
				</div>
			</div>
		);
	} else {
		changeLocationBody = (
			<Button
				className="self-start"
				disabled={busy}
				onClick={() => {
					pickFolder().catch(() => undefined);
				}}
				size="sm"
				variant="outline"
			>
				Choose folder…
			</Button>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<SettingsSection
				caption="Where Ryu stores everything on this device: chats, spaces, memory, models and downloaded engines. Relocate it to put large model files on another disk."
				title="Data folder"
			>
				{loadFailed ? (
					<div className="flex flex-col items-start gap-3 rounded-md bg-muted p-4">
						<p className="text-muted-foreground text-sm">
							We couldn't load your data folder details. Please check your
							connection and try again.
						</p>
						<Button onClick={() => refresh()} size="sm" variant="outline">
							Retry
						</Button>
					</div>
				) : (
					<SettingsGroup>
						<SettingsItem
							description={info?.current ?? "Loading…"}
							title="Current location"
						/>
						<SettingsItem
							description={
								info
									? `${humanBytes(info.size_bytes)} used · ${humanBytes(info.free_space_bytes)} free on this drive`
									: "—"
							}
							title="Size"
						/>
						{info?.is_custom ? (
							<SettingsItem
								actions={
									<Button
										disabled={busy}
										onClick={() => {
											doReset().catch(() => undefined);
										}}
										size="sm"
										variant="outline"
									>
										Reset to default
									</Button>
								}
								description={info.default}
								title="Default location"
							/>
						) : null}
					</SettingsGroup>
				)}
			</SettingsSection>

			<SettingsSection
				caption="Pick a new folder, then choose to copy your existing data over or start fresh. The app restarts to apply."
				title="Change location"
			>
				<SettingsCard className="flex flex-col gap-3">
					{changeLocationBody}
				</SettingsCard>
			</SettingsSection>

			<SettingsSection
				caption="Give another profile a copy of this one's data. For example, hand canary your stable chats, spaces and agents so you can test against real state instead of rebuilding it by hand. Both profiles stay usable; nothing here changes where THIS profile reads from."
				title="Copy to another profile"
			>
				<SettingsGroup>
					{PROFILE_COPY_TARGETS.map((target) => (
						<SettingsItem
							actions={
								<Button
									disabled={busy}
									onClick={() => setPendingProfileCopy(target)}
									size="sm"
									variant="outline"
								>
									Copy
								</Button>
							}
							description={`Copies into ~/.ryu-${target}. Refused if that profile already has data.`}
							key={target}
							title={`Copy to ${target}`}
						/>
					))}
				</SettingsGroup>
			</SettingsSection>

			<SettingsSection
				caption="Export a zip backup of the whole data folder, or restore from one. Restoring overwrites the current data and restarts the app. The backup does NOT contain your encryption key, so it can only be restored on this machine, signed in as this user."
				title="Backup &amp; restore"
			>
				<SettingsGroup>
					<SettingsItem
						actions={
							<Button
								disabled={busy}
								onClick={() => {
									doExport().catch(() => undefined);
								}}
								size="sm"
								variant="outline"
							>
								Export…
							</Button>
						}
						description="Save a zip of all your Ryu data."
						title="Export backup"
					/>
					<SettingsItem
						actions={
							<Button
								disabled={busy}
								onClick={() => {
									doImport().catch(() => undefined);
								}}
								size="sm"
								variant="outline"
							>
								Restore…
							</Button>
						}
						description="Replace current data with a backup zip."
						title="Restore backup"
					/>
				</SettingsGroup>
			</SettingsSection>

			<UploadCeilingSection />

			<AlertDialog
				onOpenChange={(nextOpen) => {
					if (!nextOpen) {
						setPendingProfileCopy(null);
					}
				}}
				open={pendingProfileCopy !== null}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Copy this profile&apos;s data to {pendingProfileCopy}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Ryu will stop, copy your chats, spaces, agents, memory and models
							into the {pendingProfileCopy} profile, and carry your encryption
							key across so the copy stays readable. This profile is left
							exactly as it is.
						</AlertDialogDescription>
						{/* The three things a user would otherwise discover the hard way,
						    stated before the irreversible step. Each corresponds to an
						    explicit exclusion or refusal in `data_path::copy_profile`. */}
						<AlertDialogDescription>
							Not copied: this node&apos;s identity and sign-in, its saved node
							list, and the downloaded binaries, so {pendingProfileCopy} runs
							its own build rather than adopting this one&apos;s. If that
							profile already has data, the copy is refused rather than merged.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={busy}
							onClick={() => {
								if (pendingProfileCopy) {
									void doProfileCopy(pendingProfileCopy);
								}
							}}
						>
							{busy ? "Copying…" : "Copy"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog
				onOpenChange={(nextOpen) => {
					if (!nextOpen) {
						setPendingRestore(null);
					}
				}}
				open={pendingRestore !== null}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Restore from this backup?</AlertDialogTitle>
						<AlertDialogDescription>
							This replaces all of your current data (chats, spaces, memory,
							models and downloaded engines) with the contents of the backup,
							then restarts the app. This cannot be undone.
						</AlertDialogDescription>
						{/* The encryption key lives in the OS keychain, never in the zip.
						    Restoring on a different machine or OS user therefore produces
						    a node that boots and looks healthy while every message body,
						    memory entry and plugin secret is unreadable — and there is no
						    rekey path to recover it. Saying so here is the only place a
						    user can still act on it. */}
						<AlertDialogDescription className="text-warning">
							Your encryption key is stored in this machine&apos;s keychain, not
							in the backup. If this zip came from another machine or another
							user account, chats, memory and plugin secrets will restore but
							stay permanently unreadable.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{pendingRestore ? (
						<div className="break-all rounded-md bg-muted p-3 text-sm">
							{pendingRestore}
						</div>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={(e) => {
								// Keep the dialog controlled by state; runImport closes it.
								e.preventDefault();
								runImport().catch(() => undefined);
							}}
							variant="destructive"
						>
							Restore &amp; restart
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
