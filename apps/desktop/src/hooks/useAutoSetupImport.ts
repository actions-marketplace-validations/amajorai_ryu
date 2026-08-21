// apps/desktop/src/hooks/useAutoSetupImport.ts
//
// Background auto-import of agent *setup* from the well-known agent config roots
// (`~/.claude`, `~/.cursor`, `~/.codex`), gated by the `ryu:auto-import-agent-setup`
// setting. The manual companion is `ImportSetupDialog`; this is the "keep my
// imported setup in sync" equivalent of `useAutoThreadImport` (threads).
//
// Deliberately conservative: only `instructions` items are auto-imported — a
// snapshot of the folder's AGENTS.md/CLAUDE.md that is additive and reversible
// (it overwrites the same preferences key each time). Skills are NOT auto-
// activated, and MCP servers / plugins / memories are NOT auto-imported: those
// spawn processes or enable plugins, so they stay behind the explicit review in
// the manual dialog. A scan runs on mount, on a fixed interval, and when the
// window regains focus.

import { useEffect, useRef } from "react";
import { readAutoSetupImportSetting } from "@/src/hooks/useAutoSetupImportSetting.ts";
import { listAgentSyncProfiles } from "@/src/lib/api/agent-sync.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import { runImport, scanImportFolder } from "@/src/lib/api/import.ts";
import { listDirectory } from "@/src/lib/api/workspace.ts";
import { useWorkspaceStore } from "@/src/store/useWorkspaceStore.ts";

/** Agent config roots auto-scanned when the setting is on. */
const AGENT_CONFIG_ROOTS = [".claude", ".cursor", ".codex"];

/** How often to rescan while the setting is on. */
const POLL_INTERVAL_MS = 5 * 60 * 1000;

/** A window regains focus at most this often triggers a rescan (debounce). */
const FOCUS_DEBOUNCE_MS = 30 * 1000;

/** Safety cap on imports per scan so a first run can't burst. */
const MAX_IMPORTS_PER_SCAN = 20;

const SEEN_KEY = "ryu:auto-imported-setup-ids";

function loadSeen(): Set<string> {
	try {
		const raw = localStorage.getItem(SEEN_KEY);
		if (!raw) {
			return new Set();
		}
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed)
			? new Set(parsed.filter((v) => typeof v === "string"))
			: new Set();
	} catch {
		return new Set();
	}
}

function saveSeen(seen: Set<string>) {
	try {
		localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
	} catch {
		// best-effort; Core's idempotent write keeps re-scans harmless
	}
}

/**
 * Mount once (e.g. in the sidebar) to auto-import setup instructions while the
 * setting is on. Renders nothing.
 */
export function useAutoSetupImport({
	target,
	onImported,
}: {
	target: ApiTarget;
	/** Called after a scan that registered at least one new project folder. */
	onImported?: () => void;
}) {
	const addProjectFolder = useWorkspaceStore((s) => s.addProjectFolder);
	const targetRef = useRef(target);
	targetRef.current = target;
	const onImportedRef = useRef(onImported);
	onImportedRef.current = onImported;
	const addFolderRef = useRef(addProjectFolder);
	addFolderRef.current = addProjectFolder;

	// One scan at a time; a poll that fires mid-scan is skipped.
	const scanningRef = useRef(false);
	const lastFocusScanRef = useRef(0);

	useEffect(() => {
		let cancelled = false;

		const scan = async () => {
			if (cancelled || scanningRef.current || !readAutoSetupImportSetting()) {
				return;
			}
			scanningRef.current = true;
			const seen = loadSeen();
			let budget = MAX_IMPORTS_PER_SCAN;
			let importedAny = false;
			try {
				// Once a root is managed by the shared Core sync ledger, the legacy
				// localStorage scheduler must stand down. Otherwise both schedulers
				// would race the same setup item even though Core eventually dedups it.
				const managedRoots = new Set(
					(
						await listAgentSyncProfiles(targetRef.current).catch(() => ({
							profiles: [],
						}))
					).profiles
						.filter((profile) => profile.importEnabled)
						.map((profile) => profile.root)
				);
				let home: string;
				try {
					const listing = await listDirectory(targetRef.current);
					home = listing.home;
				} catch {
					return;
				}
				const sep = home.includes("\\") ? "\\" : "/";
				for (const root of AGENT_CONFIG_ROOTS) {
					if (cancelled || budget <= 0) {
						break;
					}
					const rootPath = `${home}${sep}${root}`;
					if (managedRoots.has(rootPath)) {
						continue;
					}
					let scan: Awaited<ReturnType<typeof scanImportFolder>>;
					try {
						scan = await scanImportFolder(targetRef.current, rootPath);
					} catch {
						// The root may not exist (no Claude/Cursor/Codex install) —
						// degrade to nothing, never error.
						continue;
					}
					const instructions = scan.items.filter(
						(i) => i.kind === "instructions"
					);
					if (instructions.length === 0) {
						continue;
					}
					const toImport = instructions
						.filter((i) => !seen.has(`${rootPath}:${i.id}`))
						.slice(0, budget);
					if (toImport.length === 0) {
						continue;
					}
					try {
						const result = await runImport(
							targetRef.current,
							rootPath,
							toImport.map((i) => ({ kind: i.kind, id: i.id }))
						);
						for (const item of toImport) {
							seen.add(`${rootPath}:${item.id}`);
						}
						budget -= toImport.length;
						for (const r of result.results) {
							if (r.folderPath) {
								addFolderRef.current(r.folderPath);
								importedAny = true;
							}
						}
					} catch {
						// Leave the ids unseen so a later scan retries.
					}
				}
			} finally {
				saveSeen(seen);
				scanningRef.current = false;
				if (importedAny && !cancelled) {
					onImportedRef.current?.();
				}
			}
		};

		const startTimer = setTimeout(() => {
			scan().catch(() => undefined);
		}, 4000);
		const interval = setInterval(() => {
			scan().catch(() => undefined);
		}, POLL_INTERVAL_MS);
		const onFocus = () => {
			const now = Date.now();
			if (now - lastFocusScanRef.current < FOCUS_DEBOUNCE_MS) {
				return;
			}
			lastFocusScanRef.current = now;
			scan().catch(() => undefined);
		};
		window.addEventListener("focus", onFocus);

		return () => {
			cancelled = true;
			clearTimeout(startTimer);
			clearInterval(interval);
			window.removeEventListener("focus", onFocus);
		};
	}, []);
}
