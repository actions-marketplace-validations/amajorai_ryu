// Real-browser proof for the pinned-summary layout contract:
//
//   • the summary still reserves an animated sidebar rail;
//   • the composer and readable transcript content stay inside that rail;
//   • the actual message-list viewport crosses the rail, so its scrollbar is at
//     the workspace edge rather than immediately beside the short summary card.
//
// This uses the real AgentChat and CoworkContextPanel components. The surrounding
// dock shell mirrors WorkspacePanels' production geometry so the result is a
// focused, inspectable artifact even when the full desktop shell is unavailable.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { type CSSProperties, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentChat } from "../../components/agent-elements/agent-chat.tsx";
import { CoworkContextPanel } from "../../src/components/panels/CoworkContextPanel.tsx";
import "../../src/index.css";

const PINNED_COLUMN_WIDTH = 300;
const DOCK_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

const SUMMARY_MESSAGES = [
	{
		id: "summary-user",
		role: "user",
		parts: [{ type: "text", text: "Check the pinned summary layout." }],
	},
	{
		id: "summary-assistant",
		role: "assistant",
		parts: [
			{
				type: "tool-Grep",
				state: "output-available",
				input: { pattern: "workspace-content-inset", path: "apps/desktop/src" },
			},
			{
				type: "tool-Read",
				state: "output-available",
				input: {
					file_path: "apps/desktop/src/components/panels/WorkspacePanels.tsx",
				},
			},
		],
	},
] as const;

function buildTranscript(): UIMessage[] {
	const messages: UIMessage[] = [];
	for (let index = 0; index < 28; index += 1) {
		messages.push({
			id: `user-${index}`,
			parts: [
				{
					text: `Question ${index}: where does the transcript scroll?`,
					type: "text",
				},
			],
			role: "user",
		} as unknown as UIMessage);
		messages.push({
			id: `assistant-${index}`,
			parts: [
				{
					text: `The scroll viewport stays at the workspace edge while the pinned summary reserves its own animated rail. This intentionally long answer makes the scrollbar visible. ${"The readable message column remains clear of the summary card. ".repeat(4)}`,
					type: "text",
				},
			],
			role: "assistant",
		} as unknown as UIMessage);
	}
	return messages;
}

const TRANSCRIPT = buildTranscript();
const queryClient = new QueryClient();

function Story() {
	const [summaryOpen, setSummaryOpen] = useState(true);
	const inset = summaryOpen ? `${PINNED_COLUMN_WIDTH}px` : "0px";

	return (
		<div className="flex h-screen flex-col bg-background text-foreground">
			<header className="flex h-14 shrink-0 items-center justify-between border-border/60 border-b px-4">
				<div>
					<p className="font-medium text-sm">Pinned summary scrollbar proof</p>
					<p className="text-muted-foreground text-xs">
						The card is short; the transcript scrollbar belongs to the workspace
						edge.
					</p>
				</div>
				<button
					aria-pressed={summaryOpen}
					className="rounded-lg border border-border/70 px-3 py-1.5 text-xs transition-colors hover:bg-muted"
					data-testid="toggle-summary"
					onClick={() => setSummaryOpen((open) => !open)}
					type="button"
				>
					{summaryOpen ? "Hide summary" : "Show summary"}
				</button>
			</header>

			<div
				className="relative flex min-h-0 flex-1 overflow-hidden"
				data-testid="workspace"
			>
				<div
					className={`relative flex min-w-0 flex-1 flex-col ${summaryOpen ? "overflow-visible" : "overflow-hidden"}`}
					data-testid="chat-surface"
					style={{ "--workspace-content-inset": inset } as CSSProperties}
				>
					<div
						className={`min-h-0 flex-1 ${summaryOpen ? "overflow-visible" : "overflow-hidden"}`}
					>
						<AgentChat
							classNames={{
								messageList:
									"pt-8 !w-[calc(100%+var(--workspace-content-inset))] !overflow-visible",
								messageListViewport:
									"!w-full !pe-[var(--workspace-content-inset)]",
							}}
							currentUser={{ id: "user", name: "You" }}
							messages={TRANSCRIPT}
							onSend={() => {
								// The proof is read-only; the real composer remains mounted.
							}}
							status="ready"
						/>
					</div>
				</div>

				<div
					aria-hidden="true"
					className="shrink-0"
					data-testid="sidebar-spacer"
					style={{
						transition: `width 300ms ${DOCK_EASE}`,
						width: summaryOpen ? PINNED_COLUMN_WIDTH : 0,
					}}
				/>

				{summaryOpen ? (
					<aside
						aria-label="Pinned summary"
						className="slide-in-from-right-4 fade-in absolute inset-y-0 right-0 z-10 flex animate-in flex-col duration-300"
						data-testid="pinned-summary"
						style={{ width: PINNED_COLUMN_WIDTH }}
					>
						<div className="h-full overflow-y-auto py-2 pr-2 pl-1">
							<div className="w-72" data-testid="summary-card">
								<CoworkContextPanel
									maxItemsPerSection={5}
									messages={SUMMARY_MESSAGES}
									runId={null}
									target={{ url: "http://localhost:0", token: null }}
									variant="summary"
								/>
							</div>
						</div>
					</aside>
				) : null}
			</div>
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<QueryClientProvider client={queryClient}>
			<Story />
		</QueryClientProvider>
	);
}
