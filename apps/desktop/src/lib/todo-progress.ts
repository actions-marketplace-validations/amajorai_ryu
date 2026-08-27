export type TodoItemStatus = "completed" | "in_progress" | "pending";

export interface TodoProgressItem {
	label: string;
	status: TodoItemStatus;
}

export interface TodoProgressSnapshot {
	completed: number;
	current: number;
	hasInProgress: boolean;
	isComplete: boolean;
	items: TodoProgressItem[];
	percentage: number;
	total: number;
}

/** Message boundary accepted by the todo parser. The persisted and live chat
 * message types both satisfy this shape without exposing their internal part
 * unions to the sidebar. */
export interface TodoProgressMessage {
	parts?: readonly unknown[];
	role?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function todoToolName(part: Record<string, unknown>): string | undefined {
	const type = stringValue(part.type);
	if (type === "dynamic-tool") {
		return stringValue(part.toolName);
	}
	if (type?.startsWith("tool-")) {
		return type.slice("tool-".length);
	}
	return undefined;
}

function todoListOf(part: Record<string, unknown>): readonly unknown[] | null {
	const input = isRecord(part.input) ? part.input : undefined;
	if (input && Array.isArray(input.todos)) {
		return input.todos;
	}
	const output = isRecord(part.output) ? part.output : undefined;
	if (output && Array.isArray(output.newTodos)) {
		return output.newTodos;
	}
	return null;
}

function todoStatusOf(value: unknown): TodoItemStatus | undefined {
	return value === "completed" || value === "in_progress" || value === "pending"
		? value
		: undefined;
}

function todoItemsOf(items: readonly unknown[]): TodoProgressItem[] {
	const normalized: TodoProgressItem[] = [];
	for (const item of items) {
		if (!isRecord(item)) {
			continue;
		}
		const label = stringValue(item.content)?.trim();
		const status = todoStatusOf(item.status);
		if (!(label && status)) {
			continue;
		}
		normalized.push({ label, status });
	}
	return normalized;
}

/** Derive the newest non-empty TodoWrite snapshot from persisted or live parts. */
export function deriveTodoProgress(
	messages: readonly TodoProgressMessage[]
): TodoProgressSnapshot | undefined {
	for (
		let messageIndex = messages.length - 1;
		messageIndex >= 0;
		messageIndex -= 1
	) {
		const parts = messages[messageIndex]?.parts;
		if (!parts) {
			continue;
		}
		for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
			const part = parts[partIndex];
			if (!isRecord(part) || todoToolName(part) !== "TodoWrite") {
				continue;
			}
			const rawItems = todoListOf(part);
			if (!rawItems) {
				continue;
			}
			if (rawItems.length === 0) {
				return undefined;
			}

			const items = todoItemsOf(rawItems);
			if (items.length === 0) {
				return undefined;
			}
			const activeIndex = items.findIndex(
				(item) => item.status === "in_progress"
			);
			const pendingIndex = items.findIndex((item) => item.status === "pending");
			const completed = items.filter(
				(item) => item.status === "completed"
			).length;
			const total = items.length;
			return {
				completed,
				current:
					activeIndex >= 0
						? activeIndex + 1
						: pendingIndex >= 0
							? pendingIndex + 1
							: total,
				hasInProgress: activeIndex >= 0,
				isComplete: completed === total,
				items,
				percentage: Math.round((completed / total) * 100),
				total,
			};
		}
	}
	return undefined;
}
