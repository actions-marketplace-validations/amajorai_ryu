"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { useMemo, useState } from "react";
import type { RyuAssistantChatProps } from "./chat";
import { RyuAssistantChat } from "./chat";

export interface RyuAssistantCoreTarget {
	token?: string | null;
	url: string;
}

/**
 * Ready-to-run Core-backed assistant. This is the no-custom-transport path: pass
 * a node target and the widget owns the AI SDK chat loop while still exposing the
 * same Ryu Assistant surface. The token stays in the browser memory of the host.
 */
export interface RyuAssistantCoreChatProps
	extends Omit<
		RyuAssistantChatProps,
		"error" | "messages" | "onSend" | "onStop" | "status"
	> {
	agentId?: string;
	conversationId?: string;
	requestBody?: Record<string, unknown>;
	responseMode?: string;
	target: RyuAssistantCoreTarget;
}

function coreChatUrl(target: RyuAssistantCoreTarget): string {
	return `${target.url.replace(/\/+$/, "")}/api/chat/stream`;
}

export function RyuAssistantCoreChat({
	agentId = "ryu",
	conversationId,
	requestBody,
	responseMode = "work",
	target,
	...surfaceProps
}: RyuAssistantCoreChatProps) {
	const [generatedConversationId] = useState(
		() => `assistant-widget-${crypto.randomUUID()}`
	);
	const chatId = conversationId ?? generatedConversationId;
	const transport = useMemo(
		() =>
			new DefaultChatTransport<UIMessage>({
				api: coreChatUrl(target),
				body: () => ({
					...requestBody,
					agent_id: agentId,
					conversation_id: chatId,
					enable_long_term: false,
					response_mode: responseMode,
				}),
				headers: (): Record<string, string> => {
					if (!target.token) {
						return {};
					}
					return { Authorization: `Bearer ${target.token}` };
				},
			}),
		[target.token, target.url, agentId, chatId, requestBody, responseMode]
	);
	const { error, messages, sendMessage, status, stop } = useChat({
		id: chatId,
		transport,
	});

	return (
		<RyuAssistantChat
			{...surfaceProps}
			error={error ?? undefined}
			messages={messages}
			onSend={(message) => {
				void sendMessage({ text: message.content });
			}}
			onStop={stop}
			status={status}
		/>
	);
}
