import { Badge } from "@ryu/ui/components/badge";
import { Bubble, BubbleContent } from "@ryu/ui/components/bubble";
import { DitherAvatar } from "@ryu/ui/components/dither-kit/avatar";
import { Marker, MarkerContent, MarkerIcon } from "@ryu/ui/components/marker";
import {
	Message,
	MessageAvatar,
	MessageContent,
	MessageHeader,
} from "@ryu/ui/components/message";
import { cn } from "@ryu/ui/lib/utils";
import { IconMessages } from "@tabler/icons-react";
import { memo } from "react";
import type {
	AgentMessageContext,
	AgentMessageIdentity,
} from "../types.ts";
import { getToolStatus } from "../utils/format-tool.ts";
import { GenericTool } from "./generic-tool.tsx";
import {
	readAgentMessageOutput,
	readAgentMessagePayload,
	type AgentMessageToolPart,
} from "./agent-message-tool-logic.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function prettyAgentId(id: string): string {
	const label = id
		.replace(/^acp:/, "")
		.replace(/[._-]+/g, " ")
		.trim();
	if (!label) {
		return "Agent";
	}
	return label.replace(/\b\w/g, (character) => character.toUpperCase());
}

function identityFor(
	id: string,
	context: AgentMessageContext | undefined
): AgentMessageIdentity {
	if (context?.current?.id === id) {
		return context.current;
	}
	return (
		context?.resolve?.(id) ?? {
			id,
			name: prettyAgentId(id),
		}
	);
}

function IdentityAvatar({
	className,
	identity,
}: {
	className?: string;
	identity: AgentMessageIdentity;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted",
				className
			)}
		>
			{identity.avatar ?? (
				<DitherAvatar
					animate={false}
					className="size-full"
					name={identity.id}
				/>
			)}
		</span>
	);
}

function AgentChip({ identity }: { identity: AgentMessageIdentity }) {
	return (
		<Badge
			className="max-w-52 gap-1 px-1.5 font-normal"
			data-agent-id={identity.id}
			title={identity.name}
			variant="ghost"
		>
			<IdentityAvatar className="size-4" identity={identity} />
			<span className="truncate">{identity.name}</span>
		</Badge>
	);
}

export const AgentMessageTool = memo(function AgentMessageTool({
	chatStatus,
	context,
	part,
}: {
	chatStatus?: string;
	context?: AgentMessageContext;
	part: AgentMessageToolPart;
}) {
	const payload = readAgentMessagePayload(part);
	const { isError, isInterrupted, isPending } = getToolStatus(
		part as Parameters<typeof getToolStatus>[0],
		chatStatus
	);
	if (!payload) {
		return (
			<GenericTool
				isError={isError || isInterrupted}
				isPending={isPending}
				title={isPending ? "Sending message" : "Message an Agent"}
			/>
		);
	}

	const sender = identityFor(payload.from ?? context?.current?.id ?? "agent", context);
	const recipient = identityFor(payload.to, context);
	const output = readAgentMessageOutput(part);
	const deliveryFailed = isRecord(output) && output.ok === false;
	const failed = isError || isInterrupted || deliveryFailed;
	const activityVerb = failed
		? "couldn't send a message to"
		: isPending
			? "is sending a message to"
			: "sent a message to";

	return (
		<div
			aria-label={`${sender.name} ${activityVerb} ${recipient.name}`}
			className="flex min-w-0 flex-col gap-1.5"
			data-testid="agent-message-activity"
		>
			<Marker className="py-0.5 text-xs">
				<MarkerIcon>
					<IconMessages className="size-3.5" />
				</MarkerIcon>
				<MarkerContent className="flex min-w-0 flex-wrap items-center gap-1">
					<AgentChip identity={sender} />
					<span>{activityVerb}</span>
					<AgentChip identity={recipient} />
				</MarkerContent>
			</Marker>

			<Message
				align="start"
				className="items-start"
				data-testid="agent-message-bubble"
			>
				<MessageAvatar className="size-8 self-start bg-transparent">
					<IdentityAvatar className="size-8" identity={sender} />
				</MessageAvatar>
				<MessageContent className="gap-1.5">
					<MessageHeader className="gap-2 px-0">
						<span>{sender.name}</span>
						<span className="font-normal text-muted-foreground/70">
							to {recipient.name}
						</span>
					</MessageHeader>
					<Bubble
						align="start"
						className="max-w-[min(80%,42rem)]"
						variant="muted"
					>
						<BubbleContent className="whitespace-pre-wrap text-[14px] leading-relaxed">
							{payload.text}
						</BubbleContent>
					</Bubble>
				</MessageContent>
			</Message>
		</div>
	);
});
