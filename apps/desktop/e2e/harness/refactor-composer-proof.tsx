import { HotkeysProvider } from "@ryu/hotkeys/react";
import type { UIMessage } from "ai";
import { createContext, useContext, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentChat } from "../../components/agent-elements/agent-chat.tsx";
import type { InputBarProps } from "../../components/agent-elements/input-bar.tsx";
import { ChatDisplayPrefs } from "../../src/components/chat/ChatDisplayPrefsProvider.tsx";
import { CouncilInputBar } from "../../src/components/chat/CouncilInputBar.tsx";
import type { AgentSummary } from "../../src/lib/api/agents.ts";
import { DESKTOP_HOTKEYS } from "../../src/lib/hotkeys/actions.ts";
import type { MentionSources } from "../../src/lib/mentions/types.ts";
import { useProductModeStore } from "../../src/lib/product-mode.ts";
import "../../src/index.css";

const AGENT: AgentSummary = {
	id: "reviewer",
	name: "Reviewer",
	title: "Code reviewer",
	avatarGlyph: null,
	avatarUrl: null,
	builtIn: false,
	createdAt: null,
	description: null,
	engine: "acp:reviewer",
	installed: true,
	installHint: null,
	latestVersion: null,
	lifecycleStatus: "active",
	locked: false,
	model: null,
	recommended: false,
	safetyProfile: "approval_required",
	systemPrompt: null,
	transport: "acp",
	version: null,
	versionStatus: null,
};

const SOURCES: MentionSources = {
	agents: [AGENT],
	appItems: [],
	apps: [],
	chats: [{ id: "project-plan", name: "Project plan" }],
	folders: [],
	integrations: [],
	mcp: [],
	outputStyles: [],
	pages: [],
	plugins: [],
	skills: [],
	spaces: [],
	teams: [],
	users: [],
	workflows: [],
};

interface SendMetadata {
	agentId: string | null;
	references: string[];
}

const MetadataContext = createContext<{ current: SendMetadata } | null>(null);

function ProofComposer(props: InputBarProps) {
	const metadata = useContext(MetadataContext);
	if (!metadata) {
		throw new Error("Missing composer proof metadata");
	}
	return (
		<CouncilInputBar
			{...props}
			allAgents={[AGENT]}
			allTeams={[]}
			allWorkflows={[]}
			availableCommands={[
				{
					args: [],
					name: "goal",
					description: "Set a goal the agent works toward each turn",
					hint: "condition to watch for",
					source: "local",
				},
			]}
			chatWidgetTemplates={[]}
			composerSections={[]}
			currentUserId="proof-user"
			mentionSources={SOURCES}
			onHumanMentions={() => undefined}
			onReferencedChats={(references) => {
				metadata.current.references = references;
			}}
			onTargetAgentChange={(agentId) => {
				metadata.current.agentId = agentId;
			}}
			onTeamChange={() => undefined}
			onWorkflowChange={() => undefined}
		/>
	);
}

function ComposerProof() {
	const metadata = useRef<SendMetadata>({ agentId: null, references: [] });
	const [sent, setSent] = useState<({ content: string } & SendMetadata) | null>(
		null
	);
	const [messages, setMessages] = useState<UIMessage[]>([
		{
			id: "question",
			role: "user",
			parts: [{ type: "text", text: "Help me review the project plan." }],
		},
		{
			id: "answer",
			role: "assistant",
			parts: [
				{
					type: "text",
					text: "We can start with the scope and acceptance checks. Add the project conversation as context, or mention Reviewer for a second look.",
				},
			],
		},
	]);
	return (
		<MetadataContext.Provider value={metadata}>
			<main className="flex h-screen flex-col bg-background text-foreground">
				<header className="flex h-12 shrink-0 items-center justify-between border-b px-5">
					<span className="font-medium text-sm">Project review</span>
					<span className="text-muted-foreground text-xs">
						Interaction fixture · no model request
					</span>
				</header>
				<div className="min-h-0 flex-1" data-testid="product-chat">
					<ChatDisplayPrefs>
						<AgentChat
							conversationKey="refactor-composer"
							currentUser={{ id: "proof-user", name: "You" }}
							messages={messages}
							onSend={(message) => {
								setSent({ content: message.content, ...metadata.current });
								setMessages((current) => [
									...current,
									{
										id: `sent-${current.length}`,
										role: "user",
										parts: [{ type: "text", text: message.content }],
									},
								]);
							}}
							showCopyToolbar={false}
							slots={{ InputBar: ProofComposer }}
							status="ready"
						/>
					</ChatDisplayPrefs>
				</div>
				<output className="sr-only" data-testid="submitted-request">
					{JSON.stringify(sent)}
				</output>
			</main>
		</MetadataContext.Provider>
	);
}

const root = document.getElementById("root");
if (root) {
	useProductModeStore.setState({
		requestedMode: "console",
		consoleAccess: true,
	});
	createRoot(root).render(
		<HotkeysProvider registry={DESKTOP_HOTKEYS}>
			<ComposerProof />
		</HotkeysProvider>
	);
}
