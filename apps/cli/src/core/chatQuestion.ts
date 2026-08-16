import { type ApiTarget, request } from "@ryuhq/core-client/client";

export interface ChatQuestionOption {
	description?: string;
	id: string;
	label: string;
}

export interface ChatQuestionItem {
	description?: string;
	id: string;
	kind: "single" | "multi" | "text";
	options: ChatQuestionOption[];
	title: string;
}

export interface ChatQuestion {
	questions: ChatQuestionItem[];
	toolCallId: string;
}

export interface ChatQuestionAnswer {
	kind: "single" | "multi" | "text" | "skip";
	question_id: string;
	selected_ids?: string[];
	text?: string;
}

const recordOf = (value: unknown): Record<string, unknown> | null =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;

export function parseChatQuestion(value: unknown): ChatQuestion | null {
	const record = recordOf(value);
	if (!record || typeof record.toolCallId !== "string") {
		return null;
	}
	if (!Array.isArray(record.questions) || record.questions.length === 0) {
		return null;
	}
	const questions = record.questions.flatMap((value): ChatQuestionItem[] => {
		const item = recordOf(value);
		if (
			!item ||
			typeof item.id !== "string" ||
			typeof item.title !== "string"
		) {
			return [];
		}
		if (
			!(item.kind === "single" || item.kind === "multi" || item.kind === "text")
		) {
			return [];
		}
		const options = Array.isArray(item.options)
			? item.options.flatMap((option): ChatQuestionOption[] => {
					const parsed = recordOf(option);
					if (
						!parsed ||
						typeof parsed.id !== "string" ||
						typeof parsed.label !== "string"
					) {
						return [];
					}
					return [
						{
							description:
								typeof parsed.description === "string"
									? parsed.description
									: undefined,
							id: parsed.id,
							label: parsed.label,
						},
					];
				})
			: [];
		return [
			{
				description:
					typeof item.description === "string" ? item.description : undefined,
				id: item.id,
				kind: item.kind,
				options,
				title: item.title,
			},
		];
	});
	return questions.length === record.questions.length
		? { questions, toolCallId: record.toolCallId }
		: null;
}

export async function respondToChatQuestion(
	target: ApiTarget,
	conversationId: string,
	question: ChatQuestion,
	answers: ChatQuestionAnswer[]
): Promise<boolean> {
	const response = await request<{ resolved: boolean }>(
		target,
		"/api/chat/question",
		{
			method: "POST",
			body: {
				answers,
				conversation_id: conversationId,
				tool_call_id: question.toolCallId,
			},
		}
	);
	return response.resolved;
}
