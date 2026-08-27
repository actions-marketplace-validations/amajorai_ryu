// apps/desktop/src/lib/api/import.ts
//
// Client for importing agent *setup* from a scanned local folder (instructions,
// skills, MCP servers, plugins, agents, slash commands, and Claude project
// memories) — the setup-side
// companion to `agent-threads.ts`. Scan a folder Core can read, preview what it
// found, then import the selected items into Ryu's own stores.

import { type ApiTarget, authenticatedFetch } from "./client.ts";

export type ImportItemKind =
	| "instructions"
	| "skill"
	| "mcp_server"
	| "plugin"
	| "memory"
	| "agent"
	| "slash_command";

export interface ScanItem {
	/** Cheap same-name/same-id hint; the import step is authoritative. */
	alreadyExists: boolean;
	detail?: string;
	/** Opaque, root-relative locator Core round-trips back to disk. */
	id: string;
	kind: ImportItemKind;
	title: string;
}

interface ScanItemWire {
	already_exists?: boolean;
	detail?: string;
	id: string;
	kind: ImportItemKind;
	title: string;
}

export interface ScanResult {
	items: ScanItem[];
	/** Canonicalized absolute path of the scanned folder. */
	root: string;
	warnings: string[];
}

interface ScanResultWire {
	items?: ScanItemWire[];
	root?: string;
	warnings?: string[];
}

function toItem(i: ScanItemWire): ScanItem {
	return {
		kind: i.kind,
		id: i.id,
		title: i.title,
		detail: i.detail,
		alreadyExists: i.already_exists ?? false,
	};
}

/** Group the flat scan list by kind, preserving order. */
export function groupScanItems(items: ScanItem[]): {
	kind: ImportItemKind;
	label: string;
	items: ScanItem[];
}[] {
	const groups: { kind: ImportItemKind; label: string; items: ScanItem[] }[] =
		[];
	for (const item of items) {
		let group = groups.find((g) => g.kind === item.kind);
		if (!group) {
			group = {
				kind: item.kind,
				label: kindLabel(item.kind),
				items: [],
			};
			groups.push(group);
		}
		group.items.push(item);
	}
	return groups;
}

export function kindLabel(kind: ImportItemKind): string {
	switch (kind) {
		case "instructions":
			return "Instructions";
		case "skill":
			return "Skills";
		case "mcp_server":
			return "MCP servers";
		case "plugin":
			return "Plugins";
		case "memory":
			return "Memories";
		case "agent":
			return "Agents";
		case "slash_command":
			return "Slash commands";
	}
}

/**
 * Scan a local folder for importable agent setup. Read-only; resolves to the
 * found items (possibly empty) rather than throwing when nothing matches.
 */
export async function scanImportFolder(
	target: ApiTarget,
	path: string
): Promise<ScanResult> {
	const resp = await authenticatedFetch(target, "/api/import/scan", {
		method: "POST",
		body: JSON.stringify({ path }),
	});
	if (!resp.ok) {
		throw new Error(`Failed to scan folder: ${resp.status}`);
	}
	const body = (await resp.json()) as ScanResultWire;
	return {
		root: body.root ?? path,
		items: (body.items ?? []).map(toItem),
		warnings: body.warnings ?? [],
	};
}

export type ImportStatus = "imported" | "skipped" | "failed";

export interface ImportOutcome {
	alreadyExists: boolean;
	detail?: string;
	/** For `instructions` items: the containing folder to register as a project. */
	folderPath?: string;
	id: string;
	kind: ImportItemKind;
	status: ImportStatus;
	title: string;
}

interface ImportOutcomeWire {
	already_exists?: boolean;
	detail?: string;
	folder_path?: string;
	id: string;
	kind: ImportItemKind;
	status: ImportStatus;
	title: string;
}

export interface ImportSelection {
	id: string;
	kind: ImportItemKind;
}

export interface RunImportResult {
	results: ImportOutcome[];
	root: string;
}

/**
 * Import the selected scan items into Ryu's stores. Idempotent per item: things
 * already imported come back `skipped` with `alreadyExists: true`.
 */
export async function runImport(
	target: ApiTarget,
	path: string,
	items: ImportSelection[]
): Promise<RunImportResult> {
	const resp = await authenticatedFetch(target, "/api/import/run", {
		method: "POST",
		body: JSON.stringify({ path, items }),
	});
	if (!resp.ok) {
		throw new Error(`Failed to import: ${resp.status}`);
	}
	const body = (await resp.json()) as {
		root?: string;
		results?: ImportOutcomeWire[];
	};
	return {
		root: body.root ?? path,
		results: (body.results ?? []).map((r) => ({
			kind: r.kind,
			id: r.id,
			title: r.title,
			status: r.status,
			alreadyExists: r.already_exists ?? false,
			detail: r.detail,
			folderPath: r.folder_path,
		})),
	};
}
