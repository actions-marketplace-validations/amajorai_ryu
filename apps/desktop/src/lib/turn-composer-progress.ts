import { mapToolInvocationToStep } from "@ryu/blocks/desktop/agent-elements/utils/tool-adapters.ts";
import type {
	MissionStreamMessage,
	MissionStreamPart,
} from "@/src/lib/mission-control/turn-groups.ts";
import {
	firstString,
	PATH_KEYS,
	toolNameOf,
} from "@/src/lib/mission-control/turn-groups.ts";

export interface TurnChangedFile {
	deletions: number;
	insertions: number;
	path: string;
}

export interface TurnPlanProgress {
	current: number;
	items: { label: string; status: "completed" | "in_progress" | "pending" }[];
	total: number;
}

export interface TurnComposerProgress {
	deletions: number;
	files: TurnChangedFile[];
	insertions: number;
	plan?: TurnPlanProgress;
}

const WRITE_TOOLS = new Set([
	"Edit",
	"Write",
	"MultiEdit",
	"NotebookEdit",
	"apply_patch",
	"create_file",
	"str_replace_editor",
]);
const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/;
const STAT_INSERTIONS = /\+(\d+)/;
const STAT_DELETIONS = /-(\d+)/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function lineCount(value: unknown): number {
	if (typeof value !== "string" || value.length === 0) {
		return 0;
	}
	return value.split("\n").length;
}

function toolStats(
	tool: string,
	part: MissionStreamPart
): { deletions: number; insertions: number } {
	const input = isRecord(part.input) ? part.input : {};
	const output = isRecord(part.output) ? part.output : part.output;
	const step = mapToolInvocationToStep("turn-progress", {
		toolName: tool,
		args: input,
		state: part.state === "output-available" ? "result" : "call",
		result: output,
	});
	const stats = step.diffStats ?? "";
	const insertions = Number.parseInt(
		STAT_INSERTIONS.exec(stats)?.[1] ?? "0",
		10
	);
	const deletions = Number.parseInt(STAT_DELETIONS.exec(stats)?.[1] ?? "0", 10);
	if (insertions > 0 || deletions > 0) {
		return { insertions, deletions };
	}
	if (tool === "Write" || tool === "create_file") {
		return {
			insertions: lineCount(
				input.content ?? (isRecord(output) ? output.content : null)
			),
			deletions: 0,
		};
	}
	if (tool === "Edit" || tool === "str_replace_editor") {
		return {
			insertions: lineCount(input.new_string ?? input.new_str),
			deletions: lineCount(input.old_string ?? input.old_str),
		};
	}
	return { insertions: 0, deletions: 0 };
}

function addFile(
	files: Map<string, TurnChangedFile>,
	path: string,
	stats: { deletions: number; insertions: number }
): void {
	const existing = files.get(path);
	files.set(path, {
		path,
		insertions: (existing?.insertions ?? 0) + stats.insertions,
		deletions: (existing?.deletions ?? 0) + stats.deletions,
	});
}

function recordPatchFiles(
	files: Map<string, TurnChangedFile>,
	patch: unknown
): boolean {
	if (typeof patch !== "string") {
		return false;
	}
	let currentPath: string | null = null;
	let found = false;
	for (const line of patch.split("\n")) {
		const header = PATCH_FILE.exec(line);
		if (header?.[1]) {
			currentPath = header[1].trim();
			addFile(files, currentPath, { insertions: 0, deletions: 0 });
			found = true;
			continue;
		}
		if (!currentPath) {
			continue;
		}
		if (line.startsWith("+") && !line.startsWith("+++")) {
			addFile(files, currentPath, { insertions: 1, deletions: 0 });
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			addFile(files, currentPath, { insertions: 0, deletions: 1 });
		}
	}
	return found;
}

function readPlan(parts: MissionStreamPart[]): TurnPlanProgress | undefined {
	for (let index = parts.length - 1; index >= 0; index -= 1) {
		const part = parts[index];
		if (!part) {
			continue;
		}
		const tool = toolNameOf(part);
		const input = isRecord(part.input) ? part.input : {};
		const output = isRecord(part.output) ? part.output : {};
		const raw =
			tool === "TodoWrite"
				? (input.todos ?? output.newTodos)
				: tool === "update_plan"
					? input.plan
					: undefined;
		if (!Array.isArray(raw)) {
			continue;
		}
		const items = raw.flatMap((item) => {
			if (!isRecord(item)) {
				return [];
			}
			const label =
				typeof item.content === "string"
					? item.content
					: typeof item.step === "string"
						? item.step
						: null;
			const status = item.status;
			if (
				!label ||
				(status !== "completed" &&
					status !== "in_progress" &&
					status !== "pending")
			) {
				return [];
			}
			return [
				{
					label,
					status: status as "completed" | "in_progress" | "pending",
				},
			];
		});
		if (items.length === 0) {
			continue;
		}
		const activeIndex = items.findIndex(
			(item) => item.status === "in_progress"
		);
		const pendingIndex = items.findIndex((item) => item.status === "pending");
		return {
			items,
			current:
				activeIndex >= 0
					? activeIndex + 1
					: pendingIndex >= 0
						? pendingIndex + 1
						: items.length,
			total: items.length,
		};
	}
	return undefined;
}

/** Derive the live plan and file edits made after the latest user message. */
export function deriveTurnComposerProgress(
	messages: MissionStreamMessage[]
): TurnComposerProgress | undefined {
	let turnStart = -1;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]?.role === "user") {
			turnStart = index;
			break;
		}
	}
	if (turnStart < 0) {
		return undefined;
	}
	const parts = messages
		.slice(turnStart + 1)
		.filter((message) => message.role === "assistant")
		.flatMap((message) => message.parts ?? []);
	const files = new Map<string, TurnChangedFile>();
	for (const part of parts) {
		const tool = toolNameOf(part);
		if (!WRITE_TOOLS.has(tool)) {
			continue;
		}
		const input = isRecord(part.input) ? part.input : {};
		if (tool === "apply_patch" && recordPatchFiles(files, input.patch)) {
			continue;
		}
		const output = isRecord(part.output) ? part.output : {};
		const path =
			firstString(input, PATH_KEYS) ?? firstString(output, PATH_KEYS);
		if (path) {
			addFile(files, path, toolStats(tool, part));
		}
	}
	const changedFiles = [...files.values()];
	const plan = readPlan(parts);
	if (changedFiles.length === 0 && !plan) {
		return undefined;
	}
	return {
		files: changedFiles,
		plan,
		insertions: changedFiles.reduce((sum, file) => sum + file.insertions, 0),
		deletions: changedFiles.reduce((sum, file) => sum + file.deletions, 0),
	};
}
