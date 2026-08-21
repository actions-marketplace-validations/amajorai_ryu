import { ChatDisplayPrefsProvider } from "@ryu/blocks/desktop/agent-elements/chat-display-prefs";
import { InputBar } from "@ryu/blocks/desktop/agent-elements/input-bar";
import type { UIMessage } from "ai";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageList } from "../../components/agent-elements/message-list.tsx";
import "../../src/index.css";

const MESSAGES: UIMessage[] = [
	{
		id: "answer-now-user",
		parts: [{ text: "Prepare a concise answer", type: "text" }],
		role: "user",
	} as unknown as UIMessage,
	{
		id: "answer-now-assistant",
		parts: [],
		role: "assistant",
	} as unknown as UIMessage,
];

function Story() {
	const [pending, setPending] = useState(false);
	const [accepted, setAccepted] = useState(false);

	return (
		<ChatDisplayPrefsProvider value={{ hideToolDetail: false }}>
			<main className="min-h-screen bg-background px-6 py-10 text-foreground">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
					<div className="space-y-2">
						<p className="font-medium text-muted-foreground text-sm uppercase tracking-[0.18em]">
							Local reasoning control
						</p>
						<h1 className="font-semibold text-3xl tracking-tight">
							Answer now when thinking has gone on long enough
						</h1>
						<p className="max-w-2xl text-muted-foreground text-sm">
							This proof uses the shared desktop transcript and composer while a
							supported local model is still reasoning at high effort. The
							action ends reasoning and keeps the turn alive so the final answer
							can continue.
						</p>
					</div>

					<section
						aria-label="Live reasoning transcript"
						className="h-[280px] overflow-hidden rounded-3xl border border-border/70 bg-card/40 shadow-sm"
					>
						<MessageList
							answerNow={{
								onClick: () => {
									setPending(true);
									setAccepted(true);
								},
								pending,
							}}
							currentUser={{ id: "me", name: "You" }}
							initialScrollBehavior="top"
							messages={MESSAGES}
							status="streaming"
						/>
					</section>

					<section className="rounded-3xl border border-border/70 bg-card/40 p-4 shadow-sm">
						<InputBar
							onChange={() => undefined}
							onSend={() => undefined}
							onStop={() => undefined}
							status="streaming"
							value=""
						/>
					</section>

					<div
						className="rounded-2xl border border-border/70 bg-muted/30 p-4 text-sm"
						data-testid="proof-status"
					>
						<p className="font-medium">
							{accepted ? "Answer now accepted" : "Reasoning in progress"}
						</p>
						<p className="mt-1 text-muted-foreground">
							{accepted
								? "The native control request was accepted; the turn continues toward its answer."
								: "The button appears only for the provider-native reasoning phase."}
						</p>
					</div>
				</div>
			</main>
		</ChatDisplayPrefsProvider>
	);
}

const container = document.getElementById("root");
if (container) {
	createRoot(container).render(<Story />);
}
