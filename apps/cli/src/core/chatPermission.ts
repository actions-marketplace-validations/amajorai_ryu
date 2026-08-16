import { type ApiTarget, request } from "@ryuhq/core-client/client";

export interface ChatPermissionOption {
	kind: string;
	name: string;
	optionId: string;
}

export interface ChatPermission {
	options: ChatPermissionOption[];
	requestId: string;
	toolCall: unknown;
}

export function parseChatPermission(value: unknown): ChatPermission | null {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.requestId !== "string" || record.requestId.length === 0) {
		return null;
	}
	if (!Array.isArray(record.options)) {
		return null;
	}
	const options = record.options.flatMap((option): ChatPermissionOption[] => {
		if (
			option === null ||
			typeof option !== "object" ||
			Array.isArray(option)
		) {
			return [];
		}
		const item = option as Record<string, unknown>;
		if (
			typeof item.optionId !== "string" ||
			item.optionId.length === 0 ||
			typeof item.name !== "string" ||
			typeof item.kind !== "string"
		) {
			return [];
		}
		return [{ kind: item.kind, name: item.name, optionId: item.optionId }];
	});
	if (options.length === 0) {
		return null;
	}
	return {
		options,
		requestId: record.requestId,
		toolCall: record.toolCall,
	};
}

export function permissionToolTitle(toolCall: unknown): string {
	if (toolCall === null || typeof toolCall !== "object") {
		return "run a tool";
	}
	const record = toolCall as Record<string, unknown>;
	const fields =
		record.fields !== null &&
		typeof record.fields === "object" &&
		!Array.isArray(record.fields)
			? (record.fields as Record<string, unknown>)
			: undefined;
	const title = record.title ?? fields?.title;
	return typeof title === "string" && title.length > 0 ? title : "run a tool";
}

export async function respondToChatPermission(
	target: ApiTarget,
	requestId: string,
	optionId: string | null
): Promise<boolean> {
	const response = await request<{ resolved: boolean }>(
		target,
		"/api/chat/permission",
		{ method: "POST", body: { request_id: requestId, option_id: optionId } }
	);
	return response.resolved;
}
