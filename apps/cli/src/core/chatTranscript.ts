export type ToolTranscriptStatus = "pending" | "running" | "success" | "error";

export interface ChatTodo {
	content: string;
	status: "pending" | "in_progress" | "completed" | string;
}

export type ChatPart =
	| { type: "text"; text: string }
	| {
			type: "tool";
			toolCallId?: string;
			name: string;
			status: ToolTranscriptStatus;
			args?: Record<string, unknown>;
			result?: unknown;
	  }
	| { type: "reasoning"; text: string }
	| { type: "todo"; todos: ChatTodo[] };

export const asRecord = (
	value: unknown
): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

export const readTodos = (value: unknown): ChatTodo[] => {
	const record = asRecord(value);
	const raw = record?.todos;
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.flatMap((todo) => {
		const item = asRecord(todo);
		if (typeof item?.content !== "string" || typeof item.status !== "string") {
			return [];
		}
		return [{ content: item.content, status: item.status }];
	});
};

export const toolStatus = (
	status: string | undefined
): ToolTranscriptStatus => {
	switch (status?.toLowerCase()) {
		case "success":
		case "ok":
		case "completed":
		case "complete":
		case "done":
			return "success";
		case "error":
		case "failed":
		case "failure":
			return "error";
		case "pending":
			return "pending";
		default:
			return "running";
	}
};

export const appendTextPart = (parts: ChatPart[], text: string): ChatPart[] => {
	if (text.length === 0) {
		return parts;
	}
	const last = parts.at(-1);
	if (last?.type === "text") {
		return [...parts.slice(0, -1), { type: "text", text: last.text + text }];
	}
	return [...parts, { type: "text", text }];
};

export const appendReasoningPart = (
	parts: ChatPart[],
	text: string
): ChatPart[] => {
	if (text.length === 0) {
		return parts;
	}
	const last = parts.at(-1);
	if (last?.type === "reasoning") {
		return [
			...parts.slice(0, -1),
			{ type: "reasoning", text: last.text + text },
		];
	}
	return [...parts, { type: "reasoning", text }];
};

export const appendToolInputPart = (
	parts: ChatPart[],
	name: string,
	args?: Record<string, unknown>,
	toolCallId?: string
): ChatPart[] => {
	const next: ChatPart = {
		type: "tool",
		name,
		status: "running",
		...(toolCallId ? { toolCallId } : {}),
		...(args ? { args } : {}),
	};
	const existingIndex = toolCallId
		? parts.findIndex(
				(part) => part.type === "tool" && part.toolCallId === toolCallId
			)
		: -1;
	return existingIndex < 0
		? [...parts, next]
		: [
				...parts.slice(0, existingIndex),
				next,
				...parts.slice(existingIndex + 1),
			];
};

export const appendToolOutputPart = (
	parts: ChatPart[],
	status: string,
	result?: unknown,
	toolCallId?: string
): ChatPart[] => {
	if (!toolCallId) {
		return parts;
	}
	const index = parts.findLastIndex(
		(part) => part.type === "tool" && part.toolCallId === toolCallId
	);
	if (index < 0) {
		return parts;
	}
	const tool = parts[index];
	if (tool.type !== "tool") {
		return parts;
	}
	const updated: ChatPart = {
		...tool,
		status: toolStatus(status),
		...(result === undefined ? {} : { result }),
	};
	return [...parts.slice(0, index), updated, ...parts.slice(index + 1)];
};

export const replaceTodoPart = (
	parts: ChatPart[],
	todos: ChatTodo[]
): ChatPart[] => {
	if (todos.length === 0) {
		return parts;
	}
	const index = parts.findLastIndex((part) => part.type === "todo");
	const next = { type: "todo" as const, todos };
	return index < 0
		? [...parts, next]
		: [...parts.slice(0, index), next, ...parts.slice(index + 1)];
};
