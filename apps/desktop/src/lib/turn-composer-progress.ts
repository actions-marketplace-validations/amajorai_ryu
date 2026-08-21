import {
	deriveEditedFiles,
	type EditedFile,
} from "@ryu/blocks/desktop/agent-elements/turn-end-cards.ts";
import type {
	MissionStreamMessage,
	MissionStreamPart,
} from "@/src/lib/mission-control/turn-groups.ts";
import { toolNameOf } from "@/src/lib/mission-control/turn-groups.ts";

export type TurnChangedFile = EditedFile;

export interface TurnTodoProgress {
	current: number;
	items: { label: string; status: "completed" | "in_progress" | "pending" }[];
	total: number;
}

export interface TurnComposerProgress {
	deletions: number;
	files: TurnChangedFile[];
	insertions: number;
	todos?: TurnTodoProgress;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function partsWithInspectableInFlightEdits(
	parts: MissionStreamPart[]
): unknown[] {
	return parts.map((part) => {
		if (!isRecord(part)) {
			return part;
		}
		const state = part.state;
		if (
			state !== "input-available" &&
			state !== "input-streaming" &&
			state !== "streaming"
		) {
			return part;
		}
		const { state: _state, ...withoutState } = part;
		return withoutState;
	});
}

function readTodos(parts: MissionStreamPart[]): TurnTodoProgress | undefined {
	for (let index = parts.length - 1; index >= 0; index -= 1) {
		const part = parts[index];
		if (!part) {
			continue;
		}
		const tool = toolNameOf(part);
		if (tool !== "TodoWrite") {
			continue;
		}
		const input = isRecord(part.input) ? part.input : {};
		const output = isRecord(part.output) ? part.output : {};
		const raw = input.todos ?? output.newTodos;
		if (!Array.isArray(raw)) {
			continue;
		}
		const items = raw.flatMap((item) => {
			if (!isRecord(item)) {
				return [];
			}
			const label =
				typeof item.content === "string" ? item.content.trim() : null;
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
			// A valid empty snapshot clears the previous todo list. Do not fall back
			// to an older TodoWrite from this same turn and show stale progress.
			return undefined;
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

/** Derive the live todo list and file edits made after the latest user message. */
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
	const changedFiles = deriveEditedFiles(
		partsWithInspectableInFlightEdits(parts)
	);
	const todos = readTodos(parts);
	if (changedFiles.length === 0 && !todos) {
		return undefined;
	}
	return {
		files: changedFiles,
		todos,
		insertions: changedFiles.reduce((sum, file) => sum + file.insertions, 0),
		deletions: changedFiles.reduce((sum, file) => sum + file.deletions, 0),
	};
}
