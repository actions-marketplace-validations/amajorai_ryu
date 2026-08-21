import type { HostArtifact } from "./artifact-host-context.tsx";
import { artifactFromInput } from "./tools/artifact-tool.ts";
import { normalizeAssistantToolParts } from "./utils/tool-part-normalizer.ts";

/** The two places an agent-authored JSON UI can live in the transcript. */
export type JsonRenderPlacement = "inline" | "turn-end";
export type AgentUiFormat = "json-render" | "a2ui";

export interface EditedFile {
	deletions: number;
	insertions: number;
	path: string;
}

export interface FileEditsTurnEndCard {
	files: EditedFile[];
	id: string;
	kind: "file-edits";
}

export interface JsonRenderTurnEndCard {
	format?: AgentUiFormat;
	id: string;
	kind: "json-render";
	spec: unknown;
	title?: string;
}

export interface ArtifactTurnEndCard {
	artifact: HostArtifact;
	id: string;
	kind: "artifact";
}

export type TurnEndCard =
	| FileEditsTurnEndCard
	| JsonRenderTurnEndCard
	| ArtifactTurnEndCard;

const WRITE_TOOLS = new Set([
	"Edit",
	"Write",
	"MultiEdit",
	"NotebookEdit",
	"apply_patch",
	"create_file",
	"str_replace_editor",
]);

const PATH_KEYS = [
	"file_path",
	"filePath",
	"filename",
	"notebook_path",
	"notebookPath",
	"path",
] as const;

const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/;
const STAT_INSERTIONS = /\+(\d+)/;
const STAT_DELETIONS = /-(\d+)/;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null;
}

function recordOf(value: unknown): RecordValue {
	return isRecord(value) ? value : {};
}

function partToolName(part: unknown): string {
	const value = recordOf(part);
	if (typeof value.toolName === "string" && value.toolName.trim()) {
		return value.toolName.trim();
	}
	if (typeof value.type === "string" && value.type.startsWith("tool-")) {
		return value.type.slice("tool-".length);
	}
	return "";
}

function partInput(part: unknown): RecordValue {
	return recordOf(recordOf(part).input);
}

function partOutput(part: unknown): RecordValue {
	const value = recordOf(part);
	return recordOf(value.output ?? value.result);
}

function firstString(...records: RecordValue[]): string | undefined {
	for (const record of records) {
		for (const key of PATH_KEYS) {
			const value = record[key];
			if (typeof value === "string" && value.trim()) {
				return value.trim();
			}
		}
	}
	return undefined;
}

function lineCount(value: unknown): number {
	if (typeof value !== "string" || value.length === 0) {
		return 0;
	}
	return value.split(/\r?\n/).length;
}

function addStats(
	left: { deletions: number; insertions: number },
	right: { deletions: number; insertions: number }
): { deletions: number; insertions: number } {
	return {
		deletions: left.deletions + right.deletions,
		insertions: left.insertions + right.insertions,
	};
}

function emptyStats(): { deletions: number; insertions: number } {
	return { deletions: 0, insertions: 0 };
}

function addFile(
	files: Map<string, EditedFile>,
	path: string,
	stats: { deletions: number; insertions: number }
): void {
	const normalizedPath = path.trim();
	if (!normalizedPath) {
		return;
	}
	const existing = files.get(normalizedPath);
	files.set(normalizedPath, {
		deletions: (existing?.deletions ?? 0) + stats.deletions,
		insertions: (existing?.insertions ?? 0) + stats.insertions,
		path: normalizedPath,
	});
}

function statsFromDiffText(value: unknown): {
	deletions: number;
	insertions: number;
} {
	if (typeof value !== "string") {
		return emptyStats();
	}
	const insertions = Number.parseInt(
		STAT_INSERTIONS.exec(value)?.[1] ?? "0",
		10
	);
	const deletions = Number.parseInt(STAT_DELETIONS.exec(value)?.[1] ?? "0", 10);
	return {
		deletions: Number.isFinite(deletions) ? deletions : 0,
		insertions: Number.isFinite(insertions) ? insertions : 0,
	};
}

function statsFromPatchText(value: unknown): {
	deletions: number;
	insertions: number;
} {
	if (typeof value !== "string") {
		return emptyStats();
	}
	let insertions = 0;
	let deletions = 0;
	for (const line of value.split(/\r?\n/)) {
		if (line.startsWith("+") && !line.startsWith("+++")) {
			insertions += 1;
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			deletions += 1;
		}
	}
	return { deletions, insertions };
}

function statsFromStructuredPatch(value: unknown): {
	deletions: number;
	insertions: number;
} {
	if (typeof value === "string") {
		return statsFromPatchText(value);
	}
	if (!Array.isArray(value)) {
		return emptyStats();
	}
	let stats = emptyStats();
	for (const entry of value) {
		if (typeof entry === "string") {
			stats = addStats(stats, statsFromPatchText(entry));
			continue;
		}
		if (!isRecord(entry)) {
			continue;
		}
		const lines = entry.lines ?? entry.diff ?? entry.patch;
		if (lines !== undefined) {
			stats = addStats(stats, statsFromStructuredPatch(lines));
		}
		if (Array.isArray(entry.hunks)) {
			stats = addStats(stats, statsFromStructuredPatch(entry.hunks));
		}
	}
	return stats;
}

function editStats(
	tool: string,
	input: RecordValue,
	output: RecordValue
): { deletions: number; insertions: number } {
	const diffStats = [
		input.diffStats,
		input.diff_stats,
		output.diffStats,
		output.diff_stats,
	]
		.map(statsFromDiffText)
		.find((stats) => stats.insertions > 0 || stats.deletions > 0);
	if (diffStats) {
		return diffStats;
	}

	const structuredPatch =
		input.structuredPatch ??
		input.structured_patch ??
		output.structuredPatch ??
		output.structured_patch;
	const structuredStats = statsFromStructuredPatch(structuredPatch);
	if (structuredStats.insertions > 0 || structuredStats.deletions > 0) {
		return structuredStats;
	}

	if (tool === "Write" || tool === "create_file") {
		return {
			deletions: 0,
			insertions: lineCount(input.content ?? output.content),
		};
	}

	if (tool === "Edit" || tool === "str_replace_editor") {
		return {
			deletions: lineCount(input.old_string ?? input.old_str),
			insertions: lineCount(input.new_string ?? input.new_str),
		};
	}

	return emptyStats();
}

function recordPatchFiles(
	files: Map<string, EditedFile>,
	patch: unknown
): boolean {
	if (typeof patch !== "string") {
		return false;
	}
	let currentPath: string | undefined;
	let found = false;
	for (const line of patch.split(/\r?\n/)) {
		const header = PATCH_FILE.exec(line);
		if (header?.[1]) {
			currentPath = header[1].trim();
			addFile(files, currentPath, emptyStats());
			found = true;
			continue;
		}
		if (!currentPath) {
			continue;
		}
		if (line.startsWith("+") && !line.startsWith("+++")) {
			addFile(files, currentPath, { deletions: 0, insertions: 1 });
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			addFile(files, currentPath, { deletions: 1, insertions: 0 });
		}
	}
	return found;
}

function addMultiEditFiles(
	files: Map<string, EditedFile>,
	tool: string,
	input: RecordValue,
	output: RecordValue
): boolean {
	if (!Array.isArray(input.edits)) {
		return false;
	}
	let found = false;
	const fallbackPath = firstString(input, output);
	for (const edit of input.edits) {
		if (!isRecord(edit)) {
			continue;
		}
		const path = firstString(edit, input, output);
		if (!path) {
			continue;
		}
		addFile(files, path, {
			deletions: lineCount(edit.old_string ?? edit.old_str),
			insertions: lineCount(edit.new_string ?? edit.new_str ?? edit.content),
		});
		found = true;
	}
	if (!found && fallbackPath) {
		addFile(files, fallbackPath, editStats(tool, input, output));
		return true;
	}
	return found;
}

function isFailedPart(part: unknown): boolean {
	const value = recordOf(part);
	return (
		value.state === "output-error" ||
		(typeof value.errorText === "string" && value.errorText.trim().length > 0)
	);
}

function isIncompletePart(part: unknown): boolean {
	const state = recordOf(part).state;
	return ["input-available", "input-streaming", "streaming"].includes(
		String(state)
	);
}

/** Extract the completed file writes/edits represented by one assistant turn. */
export function deriveEditedFiles(parts: unknown[]): EditedFile[] {
	const files = new Map<string, EditedFile>();
	const normalizedParts = normalizeAssistantToolParts(parts ?? []);
	for (const part of normalizedParts) {
		const tool = partToolName(part);
		if (
			!WRITE_TOOLS.has(tool) ||
			isFailedPart(part) ||
			isIncompletePart(part)
		) {
			continue;
		}
		const input = partInput(part);
		const output = partOutput(part);
		if (tool === "apply_patch") {
			const patch = input.patch ?? input.diff ?? output.patch ?? output.diff;
			if (recordPatchFiles(files, patch)) {
				continue;
			}
		}
		if (
			(tool === "MultiEdit" || tool === "NotebookEdit") &&
			addMultiEditFiles(files, tool, input, output)
		) {
			continue;
		}
		const path = firstString(input, output);
		if (path) {
			addFile(files, path, editStats(tool, input, output));
		}
	}
	return [...files.values()];
}

function isUiRenderPart(part: unknown): boolean {
	const value = recordOf(part);
	return (
		value.type === "tool-ui.render" ||
		(value.type === "dynamic-tool" && value.toolName === "ui.render")
	);
}

function isArtifactRenderPart(part: unknown): boolean {
	const value = recordOf(part);
	return (
		value.type === "tool-artifact.render" ||
		(value.type === "dynamic-tool" && value.toolName === "artifact.render")
	);
}

function isRenderableSpec(value: unknown, format?: AgentUiFormat): boolean {
	if (format === "a2ui") {
		return Array.isArray(value) || typeof value === "string" || isRecord(value);
	}
	if (!isRecord(value)) {
		return false;
	}
	return typeof value.root === "string" && isRecord(value.elements);
}

function formatOf(part: unknown): AgentUiFormat | undefined {
	const format = partInput(part).format;
	return format === "json-render" || format === "a2ui" ? format : undefined;
}

function titleOf(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const title = value.trim();
	return title ? title.slice(0, 120) : undefined;
}

function placementOf(part: unknown): JsonRenderPlacement {
	return partInput(part).placement === "turn-end" ? "turn-end" : "inline";
}

export function isTurnEndJsonRenderPart(part: unknown): boolean {
	const input = partInput(part);
	const format = formatOf(part);
	return (
		isUiRenderPart(part) &&
		!isIncompletePart(part) &&
		placementOf(part) === "turn-end" &&
		isRenderableSpec(input.spec, format)
	);
}

export function isTurnEndArtifactPart(part: unknown): boolean {
	return (
		isArtifactRenderPart(part) &&
		!isIncompletePart(part) &&
		partInput(part).placement === "turn-end" &&
		artifactFromInput(partInput(part)) !== null
	);
}

/** True for edit tool parts that are represented by the completed file card. */
export function isEditedFilePart(part: unknown): boolean {
	return (
		WRITE_TOOLS.has(partToolName(part)) &&
		!isFailedPart(part) &&
		!isIncompletePart(part)
	);
}

/** True when the part will be represented by a completed end-of-turn card. */
export function isTurnEndCardPart(part: unknown): boolean {
	return isTurnEndJsonRenderPart(part) || isTurnEndArtifactPart(part);
}

/**
 * Build the durable cards for one assistant turn. The input is the persisted
 * message parts, so reopening a conversation reconstructs exactly the same
 * cards without a second server-side summary channel.
 */
export function deriveTurnEndCards(
	parts: unknown[],
	sourceId = "turn"
): TurnEndCard[] {
	const normalizedParts = normalizeAssistantToolParts(parts ?? []);
	const cards: TurnEndCard[] = [];
	const files = deriveEditedFiles(normalizedParts);
	if (files.length > 0) {
		cards.push({
			files,
			id: `${sourceId}-edited-files`,
			kind: "file-edits",
		});
	}

	for (const [index, part] of normalizedParts.entries()) {
		if (isTurnEndJsonRenderPart(part)) {
			const input = partInput(part);
			const format = formatOf(part);
			cards.push({
				...(format ? { format } : {}),
				id: `${sourceId}-json-${index}`,
				kind: "json-render",
				spec: input.spec,
				title: titleOf(input.title),
			});
			continue;
		}
		if (isTurnEndArtifactPart(part)) {
			const artifact = artifactFromInput(partInput(part));
			if (artifact) {
				cards.push({
					artifact,
					id: `${sourceId}-artifact-${index}`,
					kind: "artifact",
				});
			}
		}
	}
	return cards;
}

/** Used by Detail=None so a turn-end result card remains visible after tool rows hide. */
export function hasTurnEndCards(parts: unknown[]): boolean {
	return deriveTurnEndCards(parts).length > 0;
}
