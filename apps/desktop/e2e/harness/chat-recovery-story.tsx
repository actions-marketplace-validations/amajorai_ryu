// Standalone browser story for the recovery affordances on the real chat
// surface. It mounts the desktop MessageList and shared InputBar together so a
// screenshot proves the two related states users see after a restart:
// an interrupted turn and both sides of a compaction lifecycle are separator
// markers, while
// an empty composer stays an icon-only Play control rather than opening voice
// mode by default.

import { ChatDisplayPrefsProvider } from "@ryu/blocks/desktop/agent-elements/chat-display-prefs";
import { InputBar } from "@ryu/blocks/desktop/agent-elements/input-bar";
import type { UIMessage } from "ai";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageList } from "../../components/agent-elements/message-list.tsx";
import "../../src/index.css";

const MESSAGES: UIMessage[] = [
	{
		id: "recovery-user",
		role: "user",
		parts: [{ type: "text", text: "Continue the deployment check" }],
	} as unknown as UIMessage,
	{
		id: "recovery-assistant",
		role: "assistant",
		_interrupted: true,
		parts: [
			{
				type: "text",
				text: "I checked the first service and was about to inspect the remaining health checks.",
			},
		],
	} as unknown as UIMessage,
	{
		id: "credit-user",
		role: "user",
		parts: [{ type: "text", text: "Continue with OpenRouter" }],
	} as unknown as UIMessage,
	{
		id: "credit-assistant",
		role: "assistant",
		parts: [
			{
				type: "error",
				code: "provider_payment_required",
				title: "OpenRouter credits exhausted",
				message:
					"The OpenRouter API key on this node has no prepaid credits left. Add credits to your OpenRouter account or choose another provider, then retry.",
			},
		],
	} as unknown as UIMessage,
	{
		id: "managed-credit-user",
		role: "user",
		parts: [{ type: "text", text: "Try the managed OpenRouter lane" }],
	} as unknown as UIMessage,
	{
		id: "managed-credit-assistant",
		role: "assistant",
		parts: [
			{
				type: "error",
				code: "insufficient_credits",
				title: "Ryu credits exhausted",
				message:
					"Your organization's Ryu credits are exhausted. Open Settings > Credits to top up, or choose a BYOK or local model, then retry.",
			},
		],
	} as unknown as UIMessage,
];

function noop() {
	return undefined;
}

function Story() {
	const [retried, setRetried] = useState(0);
	return (
		<ChatDisplayPrefsProvider value={{ hideToolDetail: false }}>
			<main
				className="flex h-screen flex-col bg-background p-6"
				data-retried={String(retried)}
				data-testid="story-state"
			>
				<div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
					<section className="min-h-0 flex-1" data-testid="recovery-transcript">
						<MessageList
							currentUser={{ id: "me", name: "You" }}
							historyNotices={[
								{
									description:
										"The agent is summarizing earlier context to continue this chat.",
									id: "recovery-compacting",
									title: "Compacting earlier context",
								},
								{
									description:
										"Earlier context was summarized to continue this chat.",
									id: "recovery-compaction",
									title: "Earlier context was compacted",
								},
							]}
							initialScrollBehavior="top"
							messages={MESSAGES}
							onRegenerateMessage={() => setRetried((count) => count + 1)}
							status="ready"
						/>
					</section>

					<section data-testid="recovery-composer">
						<InputBar
							compact
							onSend={noop}
							onStop={noop}
							placeholder="Ask a follow-up"
							status="ready"
							voice={{
								transcribe: async (_audio: Blob) => "",
							}}
						/>
					</section>
				</div>
			</main>
		</ChatDisplayPrefsProvider>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
