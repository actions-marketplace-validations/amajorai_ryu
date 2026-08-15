import {
	TodoList,
	type TodoItem as BeuiTodoItem,
	type TodoItemStatus as BeuiTodoStatus,
} from "@ryu/ui/components/agents/todo-list";
import { memo, useMemo } from "react";
import { areToolPropsEqual } from "../utils/format-tool.ts";

export interface TodoItem {
	activeForm?: string;
	content: string;
	status: "pending" | "in_progress" | "completed";
}

export interface TodoToolProps {
	chatStatus?: string;
	part: TodoToolPart;
}

interface TodoToolPart {
	input?: {
		todos?: TodoItem[];
	};
	output?: {
		newTodos?: TodoItem[];
		oldTodos?: TodoItem[];
		success?: boolean;
	};
	state?: string;
}

export interface TodoChange {
	index: number;
	newStatus: TodoItem["status"];
	oldStatus?: TodoItem["status"];
	todo: TodoItem;
}

type ChangeType = "creation" | "single" | "multiple";

export interface DetectedChanges {
	items: TodoChange[];
	type: ChangeType;
}

/** Map an ACP todo's `snake_case` status onto the beUI todo status vocabulary. */
function mapStatus(status: TodoItem["status"]): BeuiTodoStatus {
	if (status === "in_progress") {
		return "in-progress";
	}
	if (status === "completed") {
		return "completed";
	}
	return "pending";
}

/** A stable id per todo row, derived from its content + position. */
function todoId(todo: TodoItem, index: number): string {
	return `${index}-${todo.content}`;
}

export const TodoTool = memo(function TodoTool({ part }: TodoToolProps) {
	const isStreaming = part.state === "input-streaming";
	const newTodos: TodoItem[] = part.input?.todos || part.output?.newTodos || [];

	const items = useMemo<BeuiTodoItem[]>(
		() =>
			newTodos.map((todo, index) => ({
				id: todoId(todo, index),
				title: todo.content,
				status: mapStatus(todo.status),
			})),
		[newTodos]
	);

	return (
		<TodoList
			items={items}
			title={isStreaming ? "Updating to-dos" : "To-dos"}
		/>
	);
}, areToolPropsEqual);
