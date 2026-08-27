import {
	Sidebar,
	SidebarContent,
	SidebarHeader,
	SidebarProvider,
} from "@ryu/ui/components/sidebar.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
	EmptyStateHeader,
	type EmptyStateLogo,
} from "../../components/agent-elements/empty-state-header.tsx";
import { InputBar } from "../../components/agent-elements/input-bar.tsx";
import { ChatsSection } from "../../src/components/layout/AppSidebar.tsx";
import { SidebarBrandBadge } from "../../src/components/layout/SidebarBrandBadge.tsx";
import type { ChatRowHandlers } from "../../src/components/layout/sidebar-conversation-rows.tsx";
import {
	type AppSurface,
	AppSurfaceProvider,
} from "../../src/contexts/app-surface-context.tsx";
import { EntitlementProvider } from "../../src/contexts/entitlement-context.tsx";
import { TabsProvider } from "../../src/contexts/TabsContext.tsx";
import type { Conversation } from "../../types/chat.ts";
import "../../src/index.css";

const PROOF_TARGET = { token: null, url: "http://proof.local" };
const STORAGE_KEYS = [
	"ryu:bot-chat-sections:v1",
	"ryu:bot-chat-section-order:v1",
	"ryu:bot-chat-section-collapsed:v1",
];

function conversation(
	id: string,
	title: string,
	updatedAt: number
): Conversation {
	return {
		createdAt: updatedAt,
		id,
		lastMessage: `${title} latest update`,
		lastMessageAt: updatedAt,
		lastMessageRole: "assistant",
		messageCount: 2,
		messages: [],
		participants: [],
		title,
		updatedAt,
	};
}

const CONVERSATIONS = [
	conversation("chat-trip", "Plan my weekend", 20),
	conversation("chat-notes", "Summarize my notes", 10),
];

const noOp = () => undefined;
const handlers = {
	activeConversationId: null,
	agents: [],
	archivedIds: new Set<string>(),
	canMakePrivate: true,
	loadMessages: () => Promise.resolve([]),
	onAddScheduledTask: noOp,
	onDeleteConversation: noOp,
	onForkConversation: noOp,
	onJumpToMessage: noOp,
	onMarkRead: noOp,
	onMarkUnread: noOp,
	onOpenInNewTab: noOp,
	onOpenInNewWindow: noOp,
	onOpenNewSideChat: noOp,
	onOpenSideChat: noOp,
	onRenameConversation: noOp,
	onRemoveFromProject: noOp,
	onRequestConversationVisibility: noOp,
	onSelectConversation: noOp,
	onSetConversationIcon: noOp,
	onToggleArchive: noOp,
	onTogglePin: noOp,
	pinnedIds: new Set<string>(),
	projectNameForFolder: () => "proof",
	target: PROOF_TARGET,
	unreadIds: new Set<string>(),
} as unknown as ChatRowHandlers;

const dnd = {
	draggingKey: null,
	dragOverKey: null,
	onDragEnd: noOp,
	onDragOver: noOp,
	onDragStart: noOp,
	onDrop: noOp,
	order: [],
};

const menu = {
	canMove: () => false,
	onHide: noOp,
	onMove: noOp,
	onOpenCustomize: noOp,
	onSetPageSize: noOp,
	onSetSort: noOp,
};

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

function ChatPreview() {
	const [draft, setDraft] = useState("");
	const [sent, setSent] = useState("");
	const logo: EmptyStateLogo = { engine: "ryu", kind: "single" };

	return (
		<section
			className="flex min-w-0 flex-1 flex-col bg-background"
			data-testid="bot-chat-surface"
		>
			<header className="flex items-center justify-between border-border/60 border-b px-8 py-5">
				<div>
					<p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
						Managed chat
					</p>
					<h1 className="mt-1 font-semibold text-2xl tracking-tight">
						Ryu Bot
					</h1>
				</div>
				<div
					className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-primary text-xs"
					data-testid="bot-managed-default"
				>
					Ryu-managed models
				</div>
			</header>
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8">
				<EmptyStateHeader
					interactiveLogo={false}
					logo={logo}
					sections={[]}
					showProjectPicker={false}
					title="What can I help with?"
				/>
				<div className="mt-8 w-full max-w-2xl">
					<InputBar
						onChange={setDraft}
						onSend={(message) => setSent(message.content)}
						onStop={noOp}
						placeholder="Ask Ryu anything"
						status="ready"
						value={draft}
					/>
					<output
						className="mt-3 block min-h-5 text-center text-muted-foreground text-xs"
						data-testid="bot-sent-message"
					>
						{sent}
					</output>
				</div>
			</div>
		</section>
	);
}

function surfaceFromUrl(): AppSurface {
	return new URLSearchParams(window.location.search).get("surface") === "web"
		? "web"
		: "desktop";
}

function Story() {
	if (new URLSearchParams(window.location.search).has("reset")) {
		for (const key of STORAGE_KEYS) {
			localStorage.removeItem(key);
		}
	}

	return (
		<AppSurfaceProvider surface={surfaceFromUrl()}>
			<QueryClientProvider client={queryClient}>
				<EntitlementProvider>
					<TabsProvider>
						<main
							className="min-h-screen bg-background p-8 text-foreground"
							data-product="ryu-bot"
						>
							<div className="mx-auto flex min-h-[720px] max-w-6xl overflow-hidden rounded-3xl border border-border/70 shadow-2xl">
								<SidebarProvider
									className="w-[280px] shrink-0"
									variant="sidebar"
								>
									<Sidebar collapsible="none" variant="sidebar">
										<SidebarHeader>
											<SidebarBrandBadge />
											<div
												aria-label="Ryu Cloud managed workspace: Connected"
												className="mx-2 mt-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2"
												data-testid="bot-connection-status"
											>
												<p className="font-medium text-xs">Ryu Cloud</p>
												<p className="mt-0.5 text-[10px] text-success">
													Connected
												</p>
											</div>
										</SidebarHeader>
										<SidebarContent>
											<ChatsSection
												botMode
												collapsed={false}
												dnd={dnd}
												handlers={handlers}
												loose={CONVERSATIONS}
												managedProduct
												menu={menu}
												onNew={noOp}
												onToggleCollapsed={noOp}
												pageSize={10}
												sectionKey="chats"
												sort="default"
											/>
										</SidebarContent>
									</Sidebar>
								</SidebarProvider>
								<ChatPreview />
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
