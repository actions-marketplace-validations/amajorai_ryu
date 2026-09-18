import type {
	AgentMessageContext,
	ContributedMessageAction,
	MessageActionRuntimeState,
} from "@ryu/blocks/desktop/agent-elements/types.ts";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@ryu/ui/components/card.tsx";
import type { UIMessage } from "ai";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { MessageReactionBucket } from "../../../../packages/blocks/src/desktop/agent-elements/message-reactions.tsx";
import { MessageList } from "../../components/agent-elements/message-list.tsx";
import { ChatDisplayPrefs } from "../../src/components/chat/ChatDisplayPrefsProvider.tsx";
import "../../src/index.css";

// This is the real persisted message id used by the live proof conversation. It
// stays a UUID so the same server-assigned-id gate used by the product renders the
// reaction action here.
const PEER_MESSAGE_ID = "56093e30-7437-4f4c-8509-39c3842376b4";
const USER_MESSAGE_ID = "26142214-91fe-4835-be6e-a78726f61365";

const REACTION_ACTION: ContributedMessageAction = {
	args: {
		dispatch: "reactions.toggle",
		renderer: "reaction-picker",
	},
	capability: "reactions.toggle",
	icon: "smile",
	id: "reactions.picker",
	kind: "menu",
	label: "Add reaction",
	order: 100,
	plugin: "@ryu/reactions",
	target: "any",
};

const MESSAGES: UIMessage[] = [
	{
		id: USER_MESSAGE_ID,
		parts: [
			{
				text: "Please review the deployment and tell the other agent when it is ready.",
				type: "text",
			},
		],
		role: "user",
	},
	{
		id: PEER_MESSAGE_ID,
		parts: [
			{
				text: "I verified the deployment and sent the peer handover.",
				type: "text",
			},
			{
				input: {
					text: "The deployment is healthy. You can continue.",
					to: "ryu",
				},
				output: {
					text: JSON.stringify({
						from: "agent-beta",
						ok: true,
						to: "ryu",
					}),
					type: "text",
				},
				state: "output-available",
				type: "tool-mcp-agent-comms.agents.send",
			},
		],
		role: "assistant",
	},
] as unknown as UIMessage[];

function AgentAvatar({ letter }: { letter: string }) {
	return (
		<span className="flex size-full items-center justify-center rounded-full bg-primary/12 font-semibold text-primary text-xs">
			{letter}
		</span>
	);
}

const AGENT_MESSAGE_CONTEXT: AgentMessageContext = {
	current: {
		avatar: <AgentAvatar letter="B" />,
		id: "agent-beta",
		name: "Beta Agent",
	},
	resolve: (id) => {
		if (id === "ryu") {
			return {
				avatar: <AgentAvatar letter="R" />,
				id,
				name: "Ryu",
			};
		}
		return undefined;
	},
};

function AgentReactionProof() {
	const [reactionBuckets, setReactionBuckets] = useState<
		Readonly<Record<string, readonly MessageReactionBucket[]>>
	>({
		[PEER_MESSAGE_ID]: [{ count: 1, emoji: "✅", reactedByMe: false }],
	});
	const messageActionStates = useMemo(() => {
		const states = new Map<string, MessageActionRuntimeState>();
		for (const [messageId, buckets] of Object.entries(reactionBuckets)) {
			states.set(messageId, { reactionBuckets: buckets });
		}
		return states;
	}, [reactionBuckets]);

	const toggleReaction = (messageId: string, emoji: string) => {
		setReactionBuckets((current) => {
			const buckets = [...(current[messageId] ?? [])];
			const index = buckets.findIndex((bucket) => bucket.emoji === emoji);
			if (index === -1) {
				return {
					...current,
					[messageId]: [...buckets, { count: 1, emoji, reactedByMe: true }],
				};
			}
			const bucket = buckets[index];
			if (!bucket) {
				return current;
			}
			return {
				...current,
				[messageId]: [
					...buckets.slice(0, index),
					{
						...bucket,
						count: bucket.reactedByMe
							? Math.max(0, bucket.count - 1)
							: bucket.count + 1,
						reactedByMe: !bucket.reactedByMe,
					},
					...buckets.slice(index + 1),
				],
			};
		});
	};

	return (
		<main
			className="min-h-screen bg-background px-5 py-8 text-foreground sm:px-8 sm:py-12"
			data-testid="agent-reaction-proof"
		>
			<div className="mx-auto max-w-5xl space-y-6">
				<header className="max-w-3xl space-y-2">
					<p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.18em]">
						SWITCHBOARD + MESSAGE REACTIONS
					</p>
					<h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">
						An agent can reply with a reaction.
					</h1>
					<p className="text-muted-foreground text-sm sm:text-base">
						The existing reaction row works on a persisted message authored by a
						peer agent, while Core keeps the reaction actor and conversation
						bound to the caller.
					</p>
				</header>

				<div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
					<Card
						className="min-w-0 overflow-hidden"
						data-testid="agent-reaction-transcript"
					>
						<CardHeader className="border-border/60 border-b py-4">
							<CardTitle className="text-base">
								Shared agent transcript
							</CardTitle>
							<p className="text-muted-foreground text-xs">
								Beta Agent's persisted reply carries the Core reaction from Ryu.
							</p>
						</CardHeader>
						<CardContent className="h-[500px] min-h-0 p-0">
							<ChatDisplayPrefs>
								<MessageList
									agentMessageContext={AGENT_MESSAGE_CONTEXT}
									assistantAvatar={<AgentAvatar letter="B" />}
									conversationKey="live-agent-reaction"
									currentUser={{ id: "human", name: "You" }}
									initialScrollBehavior="top"
									messageActionStates={messageActionStates}
									messageActions={[REACTION_ACTION]}
									messages={MESSAGES}
									onBranch={() => undefined}
									onContributedMessageAction={(_action, context) => {
										if (context.value) {
											toggleReaction(context.messageId, context.value);
										}
									}}
									onEditMessage={() => undefined}
									onQuote={() => undefined}
									onRegenerateMessage={() => undefined}
									onReply={() => undefined}
									onSpeak={() => undefined}
									showCopyToolbar
									status="ready"
								/>
							</ChatDisplayPrefs>
						</CardContent>
					</Card>

					<Card data-testid="reaction-contract">
						<CardHeader>
							<p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
								TOOL RESULT
							</p>
							<CardTitle className="text-xl">agents.react</CardTitle>
							<p className="text-muted-foreground text-sm">
								The tool uses the exact persisted id and the current
								conversation only.
							</p>
						</CardHeader>
						<CardContent className="space-y-4 text-sm">
							<div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
								<p className="font-medium text-primary">Accepted by Core</p>
								<p className="mt-1 text-muted-foreground text-xs">
									Actor <code>agent:ryu</code> · emoji ✅
								</p>
							</div>
							<dl className="space-y-3 text-xs">
								<div>
									<dt className="text-muted-foreground">Target message</dt>
									<dd className="mt-1 break-all font-mono">
										{PEER_MESSAGE_ID}
									</dd>
								</div>
								<div>
									<dt className="text-muted-foreground">Target author</dt>
									<dd className="mt-1 font-medium">agent-beta · Beta Agent</dd>
								</div>
							</dl>
						</CardContent>
					</Card>
				</div>
			</div>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<AgentReactionProof />);
}
