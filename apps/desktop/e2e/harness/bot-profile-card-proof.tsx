import { Logo } from "@ryu/ui/components/logo.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { BotProfileCard } from "../../src/components/bot/BotProfileCard.tsx";
import {
	type AppSurface,
	AppSurfaceProvider,
} from "../../src/contexts/app-surface-context.tsx";
import { EntitlementProvider } from "../../src/contexts/entitlement-context.tsx";
import { TabsProvider } from "../../src/contexts/TabsContext.tsx";
import type { ActivityItem } from "../../src/lib/api/activity.ts";
import { useLiveActivityStore } from "../../src/store/useLiveActivityStore.ts";
import { useNodeStore } from "../../src/store/useNodeStore.ts";
import type { Conversation } from "../../types/chat.ts";

import "../../src/index.css";

window.addEventListener("error", (event) => {
	const message =
		event.error instanceof Error ? event.error.message : event.message;
	document.body.dataset.proofError = message;
	document.body.innerHTML = `<pre data-testid="proof-error">${message}</pre>`;
});
window.addEventListener("unhandledrejection", (event) => {
	const message = String(event.reason);
	document.body.dataset.proofError = message;
	document.body.innerHTML = `<pre data-testid="proof-error">${message}</pre>`;
});

const PROOF_NODE = {
	name: "proof",
	token: null,
	url: "http://proof.local",
	userJwt: null,
};

const now = Math.floor(Date.now() / 1000);
const activityItems: ActivityItem[] = [
	{
		agent_id: "ryu",
		body: "Pulled the open work from three chats into one next-step summary.",
		created_at: now - 6 * 60,
		id: "activity-summary",
		kind: "run",
		level: "success",
		metadata: {},
		session_id: "chat-goal",
		source: "runs",
		title: "Completed a planning pass",
	},
	{
		agent_id: "ryu",
		body: "The weekly review found two stale follow-ups worth keeping visible.",
		created_at: now - 48 * 60,
		id: "activity-goal",
		kind: "quest",
		level: "info",
		metadata: {},
		session_id: "chat-goal",
		source: "quests",
		title: "Kept two follow-ups in view",
	},
	{
		agent_id: "ryu",
		body: "A message is ready, but Ryu is waiting for your approval before sending it.",
		created_at: now - 2 * 60 * 60,
		id: "activity-approval",
		kind: "approval",
		level: "warning",
		metadata: {},
		session_id: null,
		source: "approvals",
		title: "Draft reply needs approval",
	},
];

const conversations: Conversation[] = [
	{
		createdAt: now * 1000 - 86_400_000,
		id: "chat-goal",
		lastMessage: "Continue the launch plan",
		lastMessageAt: now * 1000 - 6 * 60_000,
		messageCount: 8,
		messages: [],
		title: "Launch plan",
		updatedAt: now * 1000 - 6 * 60_000,
	},
	{
		createdAt: now * 1000 - 172_800_000,
		id: "chat-passive",
		lastMessage: "Keep the research thread open",
		lastMessageAt: now * 1000 - 2 * 3_600_000,
		messageCount: 4,
		messages: [],
		title: "Research thread",
		updatedAt: now * 1000 - 2 * 3_600_000,
	},
];

const pendingApproval = {
	action: { type: "tool_call", tool_id: "send_message" },
	agent_id: "ryu",
	conversation_id: "chat-goal",
	created_at: new Date((now - 2 * 60 * 60) * 1000).toISOString(),
	id: "approval-send-message",
	kind: "tool_call",
	risk_tags: ["external_message"],
	status: "pending",
	summary: "Send the drafted launch update to the project channel.",
	title: "Send launch update",
};

const goalStates: Record<
	string,
	{ goal: string; status: string; turns: number; last_reason?: string }
> = {
	"chat-goal": {
		goal: "Turn the launch notes into a shippable checklist",
		last_reason:
			"The checklist is taking shape; a few owners are still missing.",
		status: "active",
		turns: 4,
	},
	"chat-passive": {
		goal: "Keep the research thread warm for the next planning review",
		last_reason: "Paused until the next review window.",
		status: "paused",
		turns: 2,
	},
};

function jsonResponse(value: unknown): Response {
	return new Response(JSON.stringify(value), {
		headers: { "content-type": "application/json" },
		status: 200,
	});
}

function installProofData() {
	if (new URLSearchParams(window.location.search).has("reset")) {
		for (const key of [
			"ryu:bot-profile-card-collapsed:v1",
			"ryu:bot-feed-preferences:v1",
			"ryu:bot-feed-engagement:v1",
		]) {
			localStorage.removeItem(key);
		}
	}
	useNodeStore.setState({ defaultNode: PROOF_NODE.name, nodes: [PROOF_NODE] });
	useLiveActivityStore.getState().reset();
	useLiveActivityStore.getState().upsert({
		action: { kind: "route", path: "/chat" },
		appId: "shell",
		detail: "Preparing the launch checklist",
		id: "run:launch-plan",
		kind: "agent-run",
		startedAt: Date.now() - 60_000,
		status: "running",
		title: "Working on launch plan",
		updatedAt: Date.now(),
	});

	const realFetch = globalThis.fetch.bind(globalThis);
	const decided = new Set<string>();
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		if (url.includes("/api/activity")) {
			return jsonResponse({ items: activityItems });
		}
		if (url.endsWith("/api/approvals")) {
			return jsonResponse({
				approvals: decided.has(pendingApproval.id) ? [] : [pendingApproval],
			});
		}
		const goalMatch = url.match(/\/api\/conversations\/([^/]+)\/goal$/);
		if (goalMatch) {
			return jsonResponse(
				goalStates[decodeURIComponent(goalMatch[1])] ?? { turns: 0 }
			);
		}
		const approvalMatch = url.match(
			/\/api\/approvals\/([^/]+)\/(approve|reject)$/
		);
		if (approvalMatch) {
			decided.add(decodeURIComponent(approvalMatch[1]));
			return jsonResponse({
				approval: {
					...pendingApproval,
					status: approvalMatch[2] === "approve" ? "approved" : "rejected",
				},
			});
		}
		if (
			url.includes("/api/conversations/") &&
			(url.endsWith("/pause") || url.endsWith("/resume"))
		) {
			const conversationId =
				url.split("/api/conversations/")[1]?.split("/")[0] ?? "";
			const state = goalStates[conversationId];
			if (state) {
				state.status = url.endsWith("/pause") ? "paused" : "active";
			}
			return jsonResponse(state ?? { turns: 0 });
		}
		return realFetch(input, init);
	}) as typeof fetch;
}

function surfaceFromUrl(): AppSurface {
	return new URLSearchParams(window.location.search).get("surface") === "web"
		? "web"
		: "desktop";
}

function Story() {
	installProofData();
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return (
		<AppSurfaceProvider surface={surfaceFromUrl()}>
			<QueryClientProvider client={queryClient}>
				<EntitlementProvider>
					<TabsProvider initialTab={{ path: "/chat", title: "New chat" }}>
						<main className="min-h-screen bg-background p-8 text-foreground">
							<div className="mx-auto flex min-h-[780px] max-w-5xl overflow-hidden rounded-3xl border border-border/70 bg-sidebar shadow-2xl">
								<aside className="w-[390px] shrink-0 border-sidebar-border border-r p-3">
									<div className="mb-3 flex items-center gap-2 px-2">
										<Logo size="20px" variant="outline" />
										<div>
											<p className="font-medium text-sm">Ryu Bot</p>
											<p className="text-[10px] text-muted-foreground">
												Managed chat workspace
											</p>
										</div>
									</div>
									<BotProfileCard conversations={conversations} />
								</aside>
								<section className="flex min-w-0 flex-1 items-center justify-center bg-background p-8">
									<div className="max-w-sm text-center">
										<p className="font-medium text-lg">What can I help with?</p>
										<p className="mt-2 text-muted-foreground text-sm">
											The profile card keeps background work, approvals, goals,
											and the feed close without turning the chat into a
											dashboard.
										</p>
									</div>
								</section>
							</div>
						</main>
					</TabsProvider>
				</EntitlementProvider>
			</QueryClientProvider>
		</AppSurfaceProvider>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
