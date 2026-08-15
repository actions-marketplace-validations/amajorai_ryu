import { useChat } from "@ai-sdk/react";
import { ClipboardIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
	AcpConfigOption,
	StreamedAcpConfig,
} from "@ryu/blocks/composer/composer-acp-sections.ts";
import { handleComposerSettingsShortcut } from "@ryu/blocks/composer/composer-shortcuts.ts";
import {
	ArtifactHostContext,
	type ArtifactHostValue,
	type HostArtifact,
} from "@ryu/blocks/desktop/agent-elements/artifact-host-context.tsx";
import { deriveContextUsage } from "@ryu/blocks/desktop/agent-elements/context-usage.tsx";
import { mergeResumedReplyMessage } from "@ryu/blocks/desktop/agent-elements/resume-merge";
import {
	WidgetHostContext,
	type WidgetHostServices,
	type WidgetHostValue,
} from "@ryu/blocks/desktop/agent-elements/widget-host-context.tsx";
import { Avatar } from "@ryu/ui/components/avatar.tsx";
import { toast } from "@ryu/ui/components/sileo.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@ryu/ui/components/tooltip.tsx";
import type { JoinAck } from "@ryuhq/core-client/realtime";
import { DefaultChatTransport } from "ai";
import type { ReactNode } from "react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { AgentChat } from "@/components/agent-elements/agent-chat.tsx";
import {
	EmptyStateHeader,
	type EmptyStateLogo,
} from "@/components/agent-elements/empty-state-header.tsx";
import { useComposerAgentControls } from "@/components/agent-elements/input/composer-agent-controls.tsx";
import type { ComposerSettingsSection } from "@/components/agent-elements/input/composer-settings-menu.tsx";
import type {
	GhostControls,
	PluginComposerControlRow,
} from "@/components/agent-elements/input/goal-plus-button.tsx";
import { useComposerAcpSections } from "@/components/agent-elements/input/use-composer-acp-sections.ts";
import type {
	AttachedImage,
	InputBarInfoBar,
	InputBarProps,
} from "@/components/agent-elements/input-bar.tsx";
import { InputBar } from "@/components/agent-elements/input-bar.tsx";
import type { QueueBarProps } from "@/components/agent-elements/queue/queue-bar.tsx";
import { formatQuotePrefix } from "@/components/agent-elements/quote.tsx";
import { openExternal } from "@/lib/tauri-bridge.ts";
import { AppLaunchpad } from "@/src/components/chat/AppLaunchpad.tsx";
import {
	BtwOverlay,
	type BtwState,
} from "@/src/components/chat/BtwOverlay.tsx";
import { DiffReviewPane } from "@/src/components/chat/DiffReviewPane.tsx";
import { InlineArtifact } from "@/src/components/chat/InlineArtifact.tsx";
import { MentionMenu } from "@/src/components/chat/MentionMenu.tsx";
import { MergedThreadPicker } from "@/src/components/chat/MergedThreadPicker.tsx";
import {
	type ActivePermission,
	PermissionPrompt,
} from "@/src/components/chat/PermissionPrompt.tsx";
import {
	type SlashCommand,
	SlashCommandAutocomplete,
} from "@/src/components/chat/SlashCommandAutocomplete.tsx";
import { WorkspaceBar } from "@/src/components/chat/WorkspaceBar.tsx";
import { PluginComposerBarControls } from "@/src/components/composer/PluginComposerBarControls.tsx";
import {
	composerPluginSectionKey,
	composerSelectOptions,
	composerSelectValue,
	partitionComposerControls,
} from "@/src/components/composer/plugin-composer-controls.ts";
import type { SubagentSummary } from "@/src/components/panels/CoworkContextPanel.tsx";
import { PinnedSummaryPanel } from "@/src/components/panels/PinnedSummaryPanel.tsx";
import {
	PanelToggleButtons,
	WorkspacePanels,
} from "@/src/components/panels/WorkspacePanels.tsx";
import { VoiceModeOverlay } from "@/src/components/voice/VoiceModeOverlay.tsx";
import { useChatHistoryContext } from "@/src/contexts/ChatHistoryContext.tsx";
import { useEntitlementContext } from "@/src/contexts/entitlement-context.tsx";
import { useSystemStatusContext } from "@/src/contexts/SystemStatusContext.tsx";
import {
	useCurrentTabId,
	useIsActiveTab,
	useTabsContext,
} from "@/src/contexts/TabsContext.tsx";
import { useTitleBar } from "@/src/contexts/TitleBarContext.tsx";
import { AppWidget } from "@/src/contributions/host/AppWidget.tsx";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { useAgents } from "@/src/hooks/useAgents.ts";
import { useComposerAutoQueue } from "@/src/hooks/useComposerAutoQueue.ts";
import { useComposerDraftAutosave } from "@/src/hooks/useComposerDraftAutosave.ts";
import { useComposerShortcutBindings } from "@/src/hooks/useComposerShortcutBindings.ts";
import { useEngineModels } from "@/src/hooks/useEngineModels.ts";
import {
	invalidateGitStatus,
	invalidateWorktreeDiff,
	invalidateWorktreeStatus,
} from "@/src/hooks/useGitStatus.ts";
import { useMcp } from "@/src/hooks/useMcp.ts";
import {
	isMergedHistoryId,
	useMergedAgentThreads,
} from "@/src/hooks/useMergedAgentThreads.ts";
import { useMessageQueue } from "@/src/hooks/useMessageQueue.ts";
import { useMessageReactions } from "@/src/hooks/useMessageReactions.ts";
import { useNodeDefaultAgentId } from "@/src/hooks/useNodeDefaultAgent.ts";
import { usePluginContributions } from "@/src/hooks/usePluginContributions.ts";
import { useSkillsCatalog } from "@/src/hooks/useSkillsCatalog.ts";
import { useSpaces } from "@/src/hooks/useSpaces.ts";
import { useTeams } from "@/src/hooks/useTeams.ts";
import { useVoiceMode } from "@/src/hooks/useVoiceMode.ts";
import { useWorkflows } from "@/src/hooks/useWorkflows.ts";
import {
	AgentAvatar,
	AgentLogo,
	engineForAgent,
} from "@/src/lib/agent-logos.tsx";
import {
	authenticateAgent,
	fetchAcpConfig,
	respondPermission,
} from "@/src/lib/api/acp.ts";
import type {
	AgentSummary,
	ConversationParticipant,
} from "@/src/lib/api/agents.ts";
import { fetchAgent, fetchParticipants } from "@/src/lib/api/agents.ts";
import type { BtwEntry } from "@/src/lib/api/btw.ts";
import { askBtw } from "@/src/lib/api/btw.ts";
import {
	cancelChat,
	chatHeaders,
	chatStreamResumeUrl,
	chatStreamUrl,
	fetchNextPromptSuggestions,
} from "@/src/lib/api/chat.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import { apiUrl, makeHeaders } from "@/src/lib/api/client.ts";
import { generateImage } from "@/src/lib/api/images.ts";
import {
	getModelContextWindow,
	getModelLaunchConfig,
} from "@/src/lib/api/inference.ts";
import {
	getConversationFeedback,
	setMessageFeedback,
} from "@/src/lib/api/message-feedback.ts";
import { pluginHostInvoke } from "@/src/lib/api/plugins.ts";
import {
	getDesktopTtsPrefs,
	getVoiceModeReadbackPrefs,
} from "@/src/lib/api/preferences.ts";
import type { Team } from "@/src/lib/api/teams.ts";
import { stageImageUpload } from "@/src/lib/api/uploads.ts";
import { generateVideo } from "@/src/lib/api/video.ts";
import { speakText, transcribeAudio } from "@/src/lib/api/voice.ts";
import {
	widgetCallTool,
	widgetFollowUp,
	widgetSetState,
} from "@/src/lib/api/widgets.ts";
import type { Workflow } from "@/src/lib/api/workflows.ts";
import type { Artifact } from "@/src/lib/artifacts.ts";
import { artifactFromPayload } from "@/src/lib/artifacts.ts";
import { hydrateHistoryMessage } from "@/src/lib/chat-history-hydrate.ts";
import {
	conversationTargetDecision,
	readLastUsedAgentId,
	rememberLastUsedAgent,
	seedComposerAgentId,
	shouldAdoptNodeDefault,
} from "@/src/lib/composer-target.ts";
import { copyChatTranscript } from "@/src/lib/copy-chat-transcript.ts";
import { instrumentedFetch } from "@/src/lib/dev-metrics.ts";
import {
	applyMention,
	buildMentionGroups,
} from "@/src/lib/mentions/candidates.ts";
import { getComposerPlugins } from "@/src/lib/mentions/plugins.ts";
import type { MentionItem, MentionSources } from "@/src/lib/mentions/types.ts";
import {
	getAgentModel,
	modelsForAgent,
	setAgentModel,
} from "@/src/lib/models.ts";
import { getRealtimeJwt, getRealtimeUserId } from "@/src/lib/realtime/jwt.ts";
import { useRealtimeRoom } from "@/src/lib/realtime/use-realtime-room.ts";
import { useAppStore } from "@/src/store/useAppStore.ts";
import { useArtifactStore } from "@/src/store/useArtifactStore.ts";
import { useChatHotkeyTargets } from "@/src/store/useChatHotkeyTargets.ts";
import { useCreateAgentDialog } from "@/src/store/useCreateAgentDialog.ts";
import { useMeetingRecordingStore } from "@/src/store/useMeetingRecordingStore.ts";
import { useWorkspaceStore } from "@/src/store/useWorkspaceStore.ts";

// How often the focused chat tab re-probes `/api/chat/stream/resume/:id` while it
// believes it is idle. The endpoint 404s in-memory when nothing is running, so
// this is deliberately cheap; the interval only has to be short enough that Stop
// appears promptly for a turn this tab did not start.
const RESUME_POLL_MS = 15_000;

// How long after an explicit Stop the resume probe stays quiet, so a turn Core
// is still tearing down cannot re-arm the composer's Stop button.
const RESUME_STOP_GRACE_MS = 5000;

// Cool-down after a resumed reader detaches, so the "stream ended" → "ready"
// transition cannot re-probe in a tight loop.
const RESUME_REATTACH_GRACE_MS = 1500;

// Idle gap after the last keystroke before we broadcast `typing:false` to the
// conversation room (multi-user presence).
const TYPING_IDLE_MS = 2500;

// Hoisted so the identity is stable. Passed inline as `{}` this is a dependency
// of the memo that builds every assistant message's element tree, so a fresh
// object rebuilds the ENTIRE transcript (markdown, tool rows, citations) on
// every render of this page.
const EMPTY_TOOL_RENDERERS: Record<string, never> = {};

/** Returns true when the selected agent uses ACP transport (never touches the gateway). */
function isAcpAgent(
	agentId: string | null,
	agents: ReturnType<typeof useAgents>["agents"]
): boolean {
	if (!agentId) {
		// No agent selected — default to ACP behaviour (no gateway needed).
		return true;
	}
	// Engine ids selected directly from the engines list (e.g. "acp:claude")
	if (agentId.startsWith("acp:")) {
		return true;
	}
	// Check against known agents in the registry
	const agent = agents.find((a) => a.id === agentId);
	if (!agent) {
		// Unknown id — default to ACP (no gateway required) to avoid false blocks.
		return true;
	}
	// Prefer the transport Core reports — the authoritative signal — over any
	// client-side re-derivation. Only "openai_compat" needs the gateway.
	if (agent.transport) {
		return agent.transport !== "openai_compat";
	}
	// Registry built-ins are always ACP
	if (agent.builtIn) {
		return true;
	}
	// Custom agents: if engine is explicitly set to an ACP variant, it's ACP
	if (agent.engine?.startsWith("acp:")) {
		return true;
	}
	// Custom agents with an explicit non-ACP engine or no engine: default to ACP
	// (openai-compat agents would have a non-null engine that does NOT start with "acp:")
	if (agent.engine && !agent.engine.startsWith("acp:")) {
		return false;
	}
	return true;
}

/**
 * Build the version-pager map (message id → { index, count, ids }) from a loaded
 * history. Only messages that actually have alternate versions (siblingCount > 1
 * with sibling ids) get an entry, so the pager renders solely at real branch
 * points.
 */
function buildVersions(
	history: Array<{
		id: string;
		siblingIndex?: number;
		siblingCount?: number;
		siblingIds?: string[];
	}>
): Record<string, { index: number; count: number; ids: string[] }> {
	const map: Record<string, { index: number; count: number; ids: string[] }> =
		{};
	for (const h of history) {
		if (h.siblingCount && h.siblingCount > 1 && h.siblingIds?.length) {
			map[h.id] = {
				index: h.siblingIndex ?? 0,
				count: h.siblingCount,
				ids: h.siblingIds,
			};
		}
	}
	return map;
}

/** Plain text from the last assistant message's parts (for auto read-back). */
function extractAssistantText(message: {
	parts?: unknown[];
	content?: string;
}): string {
	if (Array.isArray(message.parts) && message.parts.length > 0) {
		return message.parts
			.filter(
				(part): part is { type: string; text?: string } =>
					typeof part === "object" &&
					part !== null &&
					(part as { type?: string }).type === "text" &&
					typeof (part as { text?: string }).text === "string"
			)
			.map((part) => part.text ?? "")
			.join("\n\n")
			.trim();
	}
	return typeof message.content === "string" ? message.content.trim() : "";
}

/** Maps a raw error string to a user-friendly message. */
function friendlyError(raw: string): { message: string; detail: string } {
	const lower = raw.toLowerCase();
	if (
		lower.includes("executable not found") ||
		lower.includes("enoent") ||
		lower.includes("no such file")
	) {
		return {
			message: "Agent not installed - Install the agent from the Agents page.",
			detail: raw,
		};
	}
	if (
		lower.includes("connection refused") ||
		lower.includes("econnrefused") ||
		lower.includes("connect error")
	) {
		return {
			message: "Could not reach Core - Retry or start Core from Services.",
			detail: raw,
		};
	}
	return {
		message: "Something went wrong.",
		detail: raw,
	};
}

const MENTION_QUERY_RE = /(?:^|\s)@(\w*)$/;
const SLASH_QUERY_RE = /^\/(\w*)$/;
const FIRST_MENTION_RE = /@(\w+)/;
const FIRST_TEAM_MENTION_RE = /@([\w-]+)/;

/**
 * Parse the last "@word" being typed in a string.
 * Returns the partial name after "@" if the cursor is at an in-progress mention,
 * or null if the cursor is not on a mention.
 */
function parseMentionQuery(value: string): string | null {
	const match = MENTION_QUERY_RE.exec(value);
	if (!match) {
		return null;
	}
	return match[1];
}

/** Ryu's own composer commands, always offered alongside agent-advertised ones.
 *  These are intercepted client-side (`/btw`) or by a Core turn-hook plugin
 *  (`/goal`) at submit time; the popover just makes them discoverable. */
const LOCAL_SLASH_COMMANDS: SlashCommand[] = [
	{
		name: "btw",
		description: "Ask a quick side question without derailing the chat",
		hint: "your side question",
		source: "local",
	},
	{
		name: "goal",
		description: "Set a goal the agent works toward each turn",
		hint: "condition to watch for",
		source: "local",
	},
];

/**
 * Parse a leading "/word" being typed at the very start of the composer.
 * Returns the partial command name (may be empty right after "/"), or null when
 * the value isn't an in-progress slash command (e.g. once a space is typed, the
 * argument has begun and the menu should close).
 */
function parseSlashQuery(value: string): string | null {
	const match = SLASH_QUERY_RE.exec(value);
	return match ? match[1] : null;
}

/** Scan message text for the first "@Name" mention and resolve it to an agent id. */
function resolveFirstMention(
	text: string,
	agents: AgentSummary[]
): string | null {
	const match = FIRST_MENTION_RE.exec(text);
	if (!match) {
		return null;
	}
	const mentionName = match[1].toLowerCase();
	const found = agents.find((a) => a.name.toLowerCase() === mentionName);
	return found?.id ?? null;
}

/** Scan message text for the first "@Name" that matches a team, returning its id.
 *  Teams take precedence over agents when a name collides, since a team mention
 *  is the more specific "call all of them" intent. */
function resolveFirstTeamMention(text: string, teams: Team[]): string | null {
	const match = FIRST_TEAM_MENTION_RE.exec(text);
	if (!match) {
		return null;
	}
	const mentionName = match[1].toLowerCase();
	const found = teams.find((t) => t.name.toLowerCase() === mentionName);
	return found?.id ?? null;
}

/** Scan message text for the first "@Name" that matches a chat-triggerable
 *  workflow, returning its id. A workflow mention is the most specific target
 *  of all — the message becomes the run's input, so it wins over agent/team.
 *
 *  Unlike agents/teams (matched on a `@word` token), workflow names are
 *  arbitrary ("Plan → Implement → Verify"), so the check is an exact
 *  `@Name` substring match — the same form the composer inserts when you pick a
 *  workflow from the mention menu. */
function resolveFirstWorkflowMention(
	text: string,
	workflows: Workflow[]
): string | null {
	const lower = text.toLowerCase();
	const found = workflows.find((w) =>
		lower.includes(`@${w.name.toLowerCase()}`)
	);
	return found?.id ?? null;
}

// ---------------------------------------------------------------------------
/**
 * Build the per-request `plugin_flags` map from the plugin composer toggles that
 * are currently ON (plus any one-shot `action` flag fired for this turn). Every
 * composer control (including the built-in double-check toggle, which is now a
 * plugin contribution like any other) flows through this one generic map keyed by
 * each control's `flag`. Returns `undefined` when nothing is on so Core applies
 * its defaults.
 *
 * The map is BOOL-ONLY on purpose: Core's `ChatRequest::plugin_flags` is a
 * `HashMap<String, bool>`, so a string value would fail to deserialize and take
 * the whole turn down with it. A `select`/`chip` value therefore lives in the
 * composer's own `pluginControlValues` state and does NOT reach the turn until
 * Core widens that field to a JSON value.
 */
export function buildPluginFlags(
	pluginFlags: Record<string, boolean>
): Record<string, boolean> | undefined {
	const merged: Record<string, boolean> = {};
	for (const [flag, on] of Object.entries(pluginFlags)) {
		if (on) {
			merged[flag] = true;
		}
	}
	return Object.keys(merged).length > 0 ? merged : undefined;
}

// #415: Council-aware InputBar — adds @mention autocomplete above the textarea
// ---------------------------------------------------------------------------
interface CouncilInputBarProps extends InputBarProps {
	allAgents: AgentSummary[];
	allTeams: Team[];
	/** Chat-triggerable workflows (a root Input node), for @workflow mentions. */
	allWorkflows: Workflow[];
	/** Slash commands offered in the "/" popover (agent-advertised + local). */
	availableCommands: SlashCommand[];
	composerSections: ComposerSettingsSection[];
	/** Sources for the grouped "@" mention menu (agents/teams/workflows/spaces/
	 *  skills/mcp/folders/plugins). Agents/teams/workflows also drive the target. */
	mentionSources: MentionSources;
	onRespondPermission?: (optionId: string | null) => void;
	onTargetAgentChange: (agentId: string | null) => void;
	onTeamChange: (teamId: string | null) => void;
	/** Fired on each composer keystroke so the surface can broadcast a debounced
	 * "typing" presence delta to the conversation room (multi-user collaboration). */
	onTyping?: () => void;
	onWorkflowChange: (workflowId: string | null) => void;
	/** Active interactive ACP tool-permission prompt, rendered above the composer. */
	permission?: ActivePermission | null;
}

function CouncilInputBar({
	allAgents,
	allTeams,
	allWorkflows,
	availableCommands,
	composerSections,
	mentionSources,
	onTargetAgentChange,
	onTeamChange,
	onWorkflowChange,
	onTyping,
	permission,
	onRespondPermission,
	value,
	onChange,
	onSend,
	onTextareaKeyDown,
	...rest
}: CouncilInputBarProps) {
	const composerShortcuts = useComposerShortcutBindings();
	// Band-2 gate (free-tier plan): council (multi-agent) chat is a Pro feature.
	// A team @mention is the entry into council, so gate the two paths that set a
	// team target — the mention-menu pick and the send-time team resolution — and
	// open the upgrade paywall on a blocked attempt (a Pro badge does not fit in a
	// mention dropdown). Never silently downgrade a team send to single-agent.
	const { canUse, requestUpgrade } = useEntitlementContext();
	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const [slashQuery, setSlashQuery] = useState<string | null>(null);
	const textareaWrapRef = useRef<HTMLTextAreaElement | null>(null);

	// Grouped "@" candidates for the current fragment (empty when the menu is
	// closed). Recomputed per keystroke; buildMentionGroups is pure + capped.
	const mentionGroups = useMemo(
		() =>
			mentionQuery === null
				? []
				: buildMentionGroups(mentionSources, mentionQuery),
		[mentionQuery, mentionSources]
	);

	const handleChange = useCallback(
		(next: string) => {
			onChange?.(next);
			onTyping?.();
			const query = parseMentionQuery(next);
			setMentionQuery(query);
			if (query === null) {
				onTargetAgentChange(null);
				onTeamChange(null);
				onWorkflowChange(null);
			}
			setSlashQuery(parseSlashQuery(next));
		},
		[onChange, onTyping, onTargetAgentChange, onTeamChange, onWorkflowChange]
	);

	const handleSelectSlash = useCallback(
		(command: SlashCommand) => {
			// An imported user command (Codex prompt) expands straight into its
			// template body — the "prompt fills the box, then send" convention
			// Cursor/Codex use. Everything else inserts "/name " and leaves the
			// cursor for the argument.
			if (command.body) {
				onChange?.(command.body);
			} else {
				onChange?.(`/${command.name} `);
			}
			setSlashQuery(null);
		},
		[onChange]
	);

	const handleSelect = useCallback(
		(item: MentionItem) => {
			// Picking a team or a workflow enters council (multi-agent). Block it
			// behind the Pro gate before inserting the mention or setting the
			// target. Never silently downgrade a council send to single-agent.
			if (
				(item.kind === "team" || item.kind === "workflow") &&
				!canUse("council")
			) {
				setMentionQuery(null);
				requestUpgrade();
				return;
			}
			onChange?.(applyMention(value ?? "", item));
			setMentionQuery(null);
			// Agents/teams/workflows set the target directly from the picked id;
			// spaces/skills/mcp/folders are plain reference tokens and plugins
			// rewrite the composer — none of those set a target.
			if (item.kind === "workflow") {
				onWorkflowChange(item.id);
				onTeamChange(null);
				onTargetAgentChange(null);
			} else if (item.kind === "team") {
				onTeamChange(item.id);
				onTargetAgentChange(null);
				onWorkflowChange(null);
			} else if (item.kind === "agent") {
				onTargetAgentChange(item.id);
				onTeamChange(null);
				onWorkflowChange(null);
			}
		},
		[
			value,
			onChange,
			onTargetAgentChange,
			onTeamChange,
			onWorkflowChange,
			canUse,
			requestUpgrade,
		]
	);

	const handleSend = useCallback(
		(msg: { role: "user"; content: string }) => {
			// A workflow mention is the most specific target — the message becomes
			// the run's input — so it wins over a team mention, which wins over an
			// agent mention.
			const workflowId = resolveFirstWorkflowMention(msg.content, allWorkflows);
			const teamId = resolveFirstTeamMention(msg.content, allTeams);
			const blockedCouncil = (workflowId || teamId) && !canUse("council");
			// A council mention dispatches a multi-agent turn. Gate it behind Pro;
			// block the whole send (rather than silently sending single-agent) so
			// the user understands why nothing happened, then upsell.
			if (blockedCouncil) {
				setMentionQuery(null);
				setSlashQuery(null);
				requestUpgrade();
				return;
			}
			if (workflowId) {
				onWorkflowChange(workflowId);
				onTeamChange(null);
				onTargetAgentChange(null);
			} else if (teamId) {
				onTeamChange(teamId);
				onTargetAgentChange(null);
				onWorkflowChange(null);
			} else {
				onTeamChange(null);
				onWorkflowChange(null);
				onTargetAgentChange(resolveFirstMention(msg.content, allAgents));
			}
			setMentionQuery(null);
			setSlashQuery(null);
			onSend(msg);
		},
		[
			onSend,
			allAgents,
			allTeams,
			allWorkflows,
			onTargetAgentChange,
			onTeamChange,
			onWorkflowChange,
			canUse,
			requestUpgrade,
		]
	);

	return (
		<div className="relative">
			{mentionQuery !== null && mentionGroups.length > 0 && (
				<MentionMenu
					anchorRef={textareaWrapRef}
					groups={mentionGroups}
					onDismiss={() => setMentionQuery(null)}
					onSelect={handleSelect}
				/>
			)}
			{slashQuery !== null && (
				<SlashCommandAutocomplete
					anchorRef={textareaWrapRef}
					commands={availableCommands}
					onDismiss={() => setSlashQuery(null)}
					onSelect={handleSelectSlash}
					query={slashQuery}
				/>
			)}
			{permission && onRespondPermission && (
				<PermissionPrompt
					onRespond={onRespondPermission}
					permission={permission}
				/>
			)}
			<InputBar
				{...rest}
				onChange={handleChange}
				onSend={handleSend}
				onTextareaKeyDown={(event) => {
					if (
						handleComposerSettingsShortcut(
							event,
							composerSections,
							composerShortcuts
						)
					) {
						event.preventDefault();
					}
					onTextareaKeyDown?.(event);
				}}
				value={value}
			/>
		</div>
	);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: legacy component
/** Fetch a created artifact's blob as text through the node API (best-effort:
 *  a failed fetch yields null, and the surface falls back to the download/open
 *  affordance rather than an error state). */
async function fetchArtifactContent(
	target: ApiTarget,
	url: string
): Promise<string | null> {
	try {
		const res = await fetch(apiUrl(target, url), {
			headers: makeHeaders(target.token),
		});
		if (!res.ok) {
			return null;
		}
		return await res.text();
	} catch {
		return null;
	}
}

export default function ChatPage({
	tabConversationId,
	initialPrompt,
	initialSubmit,
	initialImages,
	initialAgent,
	initialGhost,
	initialProject,
	mergedAgentId,
}: {
	tabConversationId?: string;
	/**
	 * Messaging-style "one thread per agent" view (`/chat/agent/:agentId`): every
	 * earlier thread with this agent is rendered read-only above the live one, so
	 * the page reads as a single WhatsApp-shaped scroll. Purely a view — the
	 * threads stay separate rows in Core, and the composer's thread picker chooses
	 * which one a send lands in.
	 */
	mergedAgentId?: string;
	/** One-shot composer seeds from a `ryu://chat/new` deep link. The prompt
	 * pre-fills the composer (NEVER auto-sent — it is attacker-controllable);
	 * agent/project pre-select. Consumed once on mount. */
	initialPrompt?: string;
	/** When set (launchpad composer only — a user-initiated send), the seeded
	 * `initialPrompt`/`initialImages` is SENT automatically once chat is ready,
	 * instead of just pre-filling. Never set for the deep-link/Inbox paths, whose
	 * text must stay pre-fill-only. */
	initialSubmit?: boolean;
	/** One-shot image attachments staged on the launchpad composer before a
	 * conversation existed, carried into this fresh tab. Consumed once on mount. */
	initialImages?: AttachedImage[];
	initialAgent?: string;
	/** Open this thread already temporary — the launchpad's "+" offers the toggle
	 * before a conversation exists, so the pick arrives as a seed rather than as a
	 * click on this page's own row. Consumed once on mount. */
	initialGhost?: boolean;
	initialProject?: string;
} = {}) {
	// Read gateway/core reachability from the shared provider so this page and
	// the shell banner always agree on the same poll tick.
	const {
		coreReachable,
		gatewayReachable,
		loading: statusLoading,
	} = useSystemStatusContext();

	const { folder, setFolder } = useWorkspaceStore();
	// THIS TAB's composer target. Every chat tab stays mounted at once (Layout),
	// so this is deliberately per-instance state: nothing outside this ChatPage
	// may write it. The seed chain (merged-view pin → tab seed → last-used hint →
	// node default → the conversation's own pinned agent) lives in
	// `lib/composer-target.ts`; this initializer covers only its synchronous
	// links, and the two effects below cover the async ones.
	const [agentId, setAgentId] = useState<string | null>(() =>
		seedComposerAgentId({
			// The merged view is *about* one agent, so it pins the target: opening it
			// must never inherit whichever agent happened to be picked last.
			pinnedAgentId: mergedAgentId,
			seededAgentId: initialAgent,
			lastUsedAgentId: readLastUsedAgentId(),
		})
	);
	// Read-only mirror for effects that must compare against the live target
	// WITHOUT re-running when it changes — see the conversation-hydration effect,
	// where depending on `agentId` is what reverted the user's own pick.
	const agentIdRef = useRef(agentId);
	agentIdRef.current = agentId;
	// Persistent team selection from the composer target picker. When set, every
	// turn fans out to the team's members (Core's `team_id` takes precedence over
	// `agent_id`). Session-only — distinct from the transient `@team` mention ref.
	const [teamId, setTeamId] = useState<string | null>(null);
	const [agentTools, setAgentTools] = useState<string[]>([]);

	// One-shot seed from a `ryu://chat/new` deep link: pre-fill the composer and
	// pre-select the project folder. The agent is seeded above via initial state.
	// The prompt is NEVER auto-sent — only placed in the composer for review.
	const deepLinkSeeded = useRef(false);
	useEffect(() => {
		if (deepLinkSeeded.current) {
			return;
		}
		deepLinkSeeded.current = true;
		if (initialProject) {
			setFolder(initialProject).catch(() => {
				/* invalid path — leave the project unset */
			});
		}
	}, [initialProject, setFolder]);

	// Workspace panel open/close state (bottom + right panels)
	const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
	const [rightPanelOpen, setRightPanelOpen] = useState(false);
	// User's intent for the "Pinned summary" sidebar (project ▸ branch ▸
	// worktree + git changes + commit&push). It docks as its own column stacked
	// with the right panel (both can be open at once); WorkspacePanels
	// auto-demotes it to a floating overlay when the chat gets too narrow.
	const [pinnedSummaryOpen, setPinnedSummaryOpen] = useState(true);
	// Only the floating (auto-demoted) overlay overlaps the message column, so
	// only it dismisses on a press-away (the titlebar toggle brings it back).
	// Stable so the panel's outside-press listener isn't re-bound each render.
	const dismissPinnedSummary = useCallback(
		() => setPinnedSummaryOpen(false),
		[]
	);

	// "Create new agent" in the composer's agent picker opens the create dialog
	// rather than a whole editor tab.
	const { openCreateAgent } = useCreateAgentDialog();

	// Per-agent model selection for the composer model picker. Recomputed when
	// the active agent changes; the chosen id is persisted per agent and sent in
	// the chat body. The ref keeps the transport closure reading the live value.
	//
	// Seeded from THIS tab's own agent, not from the last-used one: a tab opened
	// on a specific agent (merged view, launchpad seed) otherwise started on some
	// other agent's model until the first pick.
	const [selectedModel, setSelectedModel] = useState<string | null>(() =>
		getAgentModel(agentId)
	);
	const selectedModelRef = useRef(selectedModel);

	// Image attachments — managed here so handleSend can include them in the
	// AI SDK message and clear them after send. Seeded once from `initialImages`
	// when this tab was opened from the launchpad composer (files staged before a
	// conversation existed), so they aren't lost across the launcher → chat handoff.
	const [attachedImages, setAttachedImages] = useState<
		{
			id: string;
			filename: string;
			url: string;
			mimeType: string;
			size?: number;
		}[]
	>(
		() =>
			initialImages?.map((img) => ({
				id: img.id,
				filename: img.filename,
				url: img.url,
				mimeType: img.mimeType ?? "image/png",
				size: img.size,
			})) ?? []
	);
	const [isDragOver, setIsDragOver] = useState(false);
	const attachmentRef = useRef({ attachedImages, isDragOver });
	attachmentRef.current = { attachedImages, isDragOver };

	// #415: target_agent_id for council @mentions — written by CouncilInputBar on
	// each send and consumed by the transport body closure below.
	const targetAgentIdRef = useRef<string | null>(null);

	// team_id for @team mentions — when set, Core fans the message out to the
	// team's members per its coordination strategy (takes precedence over
	// agent_id/target_agent_id). Reset after each send.
	const teamIdRef = useRef<string | null>(null);

	// Mirror of the persistent team selection for the send-time body closure
	// (assigned every render, like selectedModelRef). The transient `@team`
	// mention in teamIdRef wins for one send, then falls back to this.
	const composerTeamIdRef = useRef<string | null>(null);
	composerTeamIdRef.current = teamId;

	// workflow_id for @workflow mentions — when set, Core runs the workflow with
	// the message as its chat input (takes precedence over agent/team targets).
	// Reset after each send, mirroring teamIdRef.
	const workflowIdRef = useRef<string | null>(null);

	// #415: Current participants list for labelling assistant messages per-agent.
	const [participants, setParticipants] = useState<ConversationParticipant[]>(
		[]
	);

	// #415: Maps assistant-message index (string) to an agent display name for labels.
	const agentLabelMapRef = useRef<Record<string, string>>({});

	// Load agents to inspect the selected agent's transport type.
	const { agents } = useAgents();
	// Load teams so @team mentions resolve in the composer autocomplete.
	const { teams } = useTeams();
	// Load workflows so @workflow mentions resolve in the composer autocomplete.
	// Only chat-triggerable ones (a root Input node, per Core) surface in the
	// mention menu; the rest can still be run from the Workflows app.
	const { workflows } = useWorkflows();
	// Extra "@" mention sources: spaces, installed skills, MCP servers, and
	// recent project folders. Composer plugins (goal/proof/double-check) come
	// from the client-side registry. See docs/rfc-mention-composer.md.
	const { spaces } = useSpaces();
	const { installedSkills } = useSkillsCatalog();
	const { servers: mcpServers } = useMcp();
	const recentFolders = useWorkspaceStore((s) => s.recentFolders);
	// Core-owned per-engine model catalog (offline fallback lives in models.ts).
	const engineModels = useEngineModels();

	// #402: Derive transport-aware gating flags.
	// Core down = all chat off regardless of agent.
	// Gateway required only when the selected agent uses openai-compat transport.
	const acpAgent = isAcpAgent(agentId, agents);
	const chatDisabled = statusLoading ? false : !coreReachable;
	const gatewayRequiredForAgent = !(acpAgent || gatewayReachable);

	// The reason a blocked composer is disabled is surfaced in the sidebar
	// Announcements section (see useSystemAnnouncements) rather than as an
	// inline overlay banner, so the composer just quietly disables here.

	const composerBlocked = chatDisabled || gatewayRequiredForAgent;

	// Long-term (cross-session) memory is opt-in per the privacy-by-default
	// principle. Persisted locally so the choice survives restarts.
	const [longTermMemory] = useState<boolean>(
		() => localStorage.getItem("ryu_long_term_memory") === "true"
	);

	// Remember the last picked agent so a new chat opens with it preselected. The
	// agent itself is owned by Core (CRUD via U6); this is only the local "last
	// used" hint, not agent storage.
	const {
		openTab,
		updateTabBusy,
		bindTabConversation,
		tabs,
		clearScrollToMessage,
	} = useTabsContext();
	const currentTabId = useCurrentTabId();
	const scrollToMessageId = currentTabId
		? tabs.find((t) => t.id === currentTabId)?.scrollToMessageId
		: undefined;

	// Model options follow the active agent's engine binding. The effective
	// value prefers the explicit in-session pick, then the persisted per-agent
	// choice, then the engine's first option — so the picker always shows what
	// will actually be sent.
	const modelOptions = useMemo(
		() => modelsForAgent(agentId, agents, engineModels),
		[agentId, agents, engineModels]
	);
	const effectiveModel =
		[selectedModel, getAgentModel(agentId)].find(
			(id) => id && modelOptions.some((m) => m.id === id)
		) ??
		modelOptions[0]?.id ??
		null;
	selectedModelRef.current = effectiveModel;

	// The empty-state logo reflects the active target: a team fans out its
	// members' engine logos; any single agent (Ryu included) shows its own mark.
	const emptyStateLogo = useMemo<EmptyStateLogo>(() => {
		if (teamId) {
			const team = teams.find((t) => t.id === teamId);
			const engines = (team?.members ?? []).map((id) => {
				const member = agents.find((a) => a.id === id);
				return member ? engineForAgent(member) : null;
			});
			if (engines.length > 0) {
				return { kind: "stack", engines };
			}
		}
		const agent = agents.find((a) => a.id === agentId);
		if (agent?.avatarUrl) {
			return { kind: "image", url: agent.avatarUrl };
		}
		return { kind: "single", engine: agent ? engineForAgent(agent) : null };
	}, [agentId, teamId, agents, teams]);

	// Avatar + name shown beside each assistant turn in the transcript. A single
	// agent shows its engine logo in a circular avatar; a team shows its name
	// (the fanned member avatars are wired separately). Mirrors emptyStateLogo.
	const assistantIdentity = useMemo<{
		avatar?: React.ReactNode;
		name?: string;
	}>(() => {
		if (teamId) {
			const team = teams.find((t) => t.id === teamId);
			return { name: team?.name };
		}
		const agent = agents.find((a) => a.id === agentId);
		if (!agent) {
			return {};
		}
		return {
			name: agent.name,
			avatar: (
				<Avatar
					className="flex items-center justify-center after:hidden"
					size="sm"
				>
					{agent.avatarUrl ? (
						// biome-ignore lint/performance/noImgElement: Tauri/Vite app, no next/image; avatar is an inline data URL
						// biome-ignore lint/correctness/useImageSize: sized via the `size-full` class
						<img
							alt={agent.name}
							className="size-full rounded-full object-cover"
							src={agent.avatarUrl}
						/>
					) : (
						<AgentLogo engine={engineForAgent(agent)} size="16px" />
					)}
				</Avatar>
			),
		};
	}, [agentId, teamId, agents, teams]);

	// Marks for the live status row. A team is the case where more than one agent
	// is genuinely on the same turn, so it contributes one mark per member; a
	// single agent contributes its own. Built from the same `agents`/`teams`
	// lookups as the identity above rather than from the transcript, because a
	// turn that has produced nothing yet carries no agent attribution at all —
	// and that is exactly when this row is on screen.
	const assistantPlanningAvatars = useMemo<React.ReactNode[]>(() => {
		// `AgentAvatar` with an explicit 16px class, NOT the `<Avatar size="sm">`
		// wrapper the transcript's per-turn identity uses: that component carries its
		// own size class, which wins over whatever slot it is dropped into, so a row
		// of them would not line up with the 16px status line they sit on. This is
		// the same shape the sidebar's ChatRow draws its agent mark with.
		const mark = (agent: (typeof agents)[number]) => (
			<AgentAvatar
				avatarUrl={agent.avatarUrl}
				className="size-4 shrink-0 rounded-[3px] object-contain"
				engine={engineForAgent(agent)}
				key={agent.id}
				size="16px"
			/>
		);
		if (teamId) {
			const team = teams.find((t) => t.id === teamId);
			const members = (team?.members ?? [])
				.map((id) => agents.find((a) => a.id === id))
				.filter((a): a is (typeof agents)[number] => Boolean(a));
			if (members.length > 0) {
				return members.map(mark);
			}
		}
		const agent = agents.find((a) => a.id === agentId);
		return agent ? [mark(agent)] : [];
	}, [agentId, teamId, agents, teams]);

	const handleModelChange = useCallback(
		(modelId: string) => {
			setSelectedModel(modelId);
			if (agentId) {
				setAgentModel(agentId, modelId);
			}
		},
		[agentId]
	);

	// ── ACP session controls (Zed-style, data-driven per active agent) ──
	// The agent's advertised Model + Thinking/approval + config selectors, plus the
	// effective per-turn selections, come from the ONE shared hook the launchpad and
	// Ask Ryu dock also use — so every composer's dropdown is identical (and shows
	// them even before a chat exists). Selections persist per agent and ride each
	// turn's request body; Core re-applies them via set_mode / set_config_option /
	// set_model. `modelSection`/`extraSections` feed the composer's settings menu.
	// An agent-INITIATED permission-mode switch seen on the live stream (Core's
	// `data-ryu-acp-mode` part). Derived from `messages` further below and fed
	// back into the composer hook so the Approval picker reflects a mode the
	// agent changed on its own — not only the user's clicks.
	const [streamedAcpMode, setStreamedAcpMode] = useState<string | null>(null);
	// The same shape one level up: session CONFIG values the agent asked the client
	// to update (Core's `data-ryu-acp-config` part). Derived from `messages` below
	// and fed back into the composer hook, which adopts and persists them — so a
	// pick the agent's own action invalidated stops being re-sent next turn. The
	// emission `key` rides along so both sides dedupe on the PART, not the value.
	const [streamedAcpConfig, setStreamedAcpConfig] =
		useState<StreamedAcpConfig | null>(null);
	// The agent's config option DEFINITIONS as re-published against the LIVE
	// session (Core's `data-ryu-acp-config-options` part) — the answer to
	// `session/set_config_option`, which by protocol returns the whole refreshed
	// set. Distinct from `streamedAcpConfig`, which carries option VALUES.
	//
	// This is the only way an option that exists solely for another option's value
	// (codex reveals its reasoning `effort` list once a model that has one is
	// picked) can reach the pickers against the real session: the probe that
	// otherwise supplies them runs in a throwaway session of its own.
	const [streamedAcpConfigOptions, setStreamedAcpConfigOptions] = useState<
		AcpConfigOption[] | null
	>(null);

	// Whether a turn is in flight, for the pick notice below. A ref because the
	// notice callback is created here, ABOVE `useChat`'s `status` (assigned into
	// this ref right after that hook), and reading it live would be a TDZ error.
	const turnInFlightRef = useRef(false);
	// Changing Approval / Model / Thinking mid-chat is silent by design: the pick
	// is sticky, rides the NEXT turn's request body, and Core re-applies it to the
	// live ACP session before that turn's prompt (`apply_turn_config`). Nothing on
	// screen moves, so without this the user has no way to know the switch took —
	// the "did my bypass-permissions click do anything?" gap. One fixed toast slot
	// so dragging the thinking slider across detents replaces in place instead of
	// stacking a toast per detent.
	const handleAcpSelectionApplied = useCallback(
		(setting: string, value: string) => {
			toast.info({
				id: "ryu-acp-selection-applied",
				title: `${setting}: ${value}`,
				description: turnInFlightRef.current
					? "Applies after the current response."
					: "Applies from your next message.",
			});
		},
		[]
	);

	const acp = useComposerAcpSections({
		agentId,
		agents,
		modelOptions,
		engineModel: effectiveModel,
		onEngineModelChange: handleModelChange,
		onSelectionApplied: handleAcpSelectionApplied,
		streamedMode: streamedAcpMode,
		streamedConfig: streamedAcpConfig,
		streamedConfigOptions: streamedAcpConfigOptions,
	});

	// Effective ACP selections for the request body, held in refs so the send path
	// reads current values without re-identifying the memoized composer slot. The
	// hook already nulls acp_mode when a category:"mode" config option owns it.
	const acpModeRef = useRef(acp.acpMode);
	acpModeRef.current = acp.acpMode;
	const acpModelRef = useRef(acp.acpModel);
	acpModelRef.current = acp.acpModel;
	const acpOptionValuesRef = useRef(acp.acpOptionValues);
	acpOptionValuesRef.current = acp.acpOptionValues;

	// Fetch tool names for the selected agent so we can render tool chips below
	// the composer. Uses the lightweight full-record fetch (tools[] is not on the
	// summary). Clears on deselect and re-fetches when the agent changes.
	const activeNodeForTools = useActiveNode();
	useEffect(() => {
		if (!agentId) {
			setAgentTools([]);
			return;
		}
		let cancelled = false;
		const toolTarget: ApiTarget = {
			url: activeNodeForTools.url,
			token: activeNodeForTools.token ?? null,
		};
		fetchAgent(toolTarget, agentId)
			.then((agent) => {
				if (!cancelled) {
					setAgentTools(agent.tools ?? []);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setAgentTools([]);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [agentId, activeNodeForTools.url, activeNodeForTools.token]);

	const {
		activeConversationId,
		setActiveConversationId,
		createConversation,
		getConversation,
		loadMessages,
		loadMessagesResult,
		forkConversation,
		editMessage,
		regenerateMessage,
		selectVersion,
		seedTitleFromFirstMessage,
		setConversationFolder,
		refresh,
	} = useChatHistoryContext();

	// Version-tree state (ChatGPT/Claude edit + regenerate branching), keyed by
	// message id: how many versions exist at this branch point, which is active,
	// and the ordered sibling ids the pager steps through. Populated from Core's
	// active-path read on every (re)hydration; empty for never-branched threads.
	const [versions, setVersions] = useState<
		Record<string, { index: number; count: number; ids: string[] }>
	>({});
	// Persisted thumbs 👍/👎 for the active conversation, keyed by assistant
	// message id. Loaded when the conversation switches; updated optimistically on
	// a vote (reverted if the server rejects it).
	const [feedback, setFeedback] = useState<Record<string, "up" | "down">>({});
	// One-shot flag consumed by the chat-stream body: when a regenerate()/edit
	// re-run streams, Core must NOT re-append the trailing user turn (it is
	// already persisted). Set immediately before regenerate(), reset on read.
	const skipNextUserAppendRef = useRef(false);

	// This tab's OWN conversation id, independent of the shared focused-tab
	// `activeConversationId`. Every chat tab stays mounted at once (Layout), and
	// AI SDK's `useChat({ id })` shares ONE Chat instance across all hooks that
	// pass the same id — so keying every mounted tab off the single global id
	// made a newly-opened conversation collide with an already-mounted tab and
	// render empty (the new mount's blank initial state clobbered the loaded
	// history). Keying each tab off its own id keeps the threads independent.
	const [convId, setConvId] = useState<string | null>(
		tabConversationId ?? null
	);

	// Restore state for THIS tab's thread. Seeded `true` whenever the tab is
	// restored onto an existing conversation: the first paint happens before the
	// hydration effect below has even fired, and a tab that reports "not loading,
	// no messages" in that window renders the new-chat greeting — the "all my
	// chats are gone" screen the boot bug is actually about. A fresh chat has no
	// conversation id and therefore never enters this state.
	const [historyLoading, setHistoryLoading] = useState(
		Boolean(tabConversationId)
	);
	// The fetch came back as a transport/HTTP failure. Distinct from "loaded and
	// empty" — the thread exists, this node just could not be reached.
	const [historyFailed, setHistoryFailed] = useState(false);
	// Reload nonce: bumping it re-runs the hydration effect for the Try-again
	// button without touching the auto-refresh paths.
	const [historyReloadKey, setHistoryReloadKey] = useState(0);

	// ── Merged agent view ────────────────────────────────────────────────────
	// Older threads with this agent, rendered read-only above the live one. The
	// live thread is still a single conversation driven by `useChat`; only the
	// transcript above it is stitched, so streaming, editing and branching keep
	// working unchanged on the thread the composer is pointed at.
	const merged = useMergedAgentThreads({
		agentId: mergedAgentId ?? null,
		enabled: Boolean(mergedAgentId),
		liveConversationId: convId,
	});
	// Opening the view lands on the newest thread — the messaging-app default of
	// "continue where we left off".
	//
	// The latch trips the first time a thread list EXISTS, not the first time a
	// thread is selected. The conversation list is empty until Core's first fetch
	// resolves, so a latch that only trips on success would still be armed if the
	// user hit "New thread" in that window (or on a later reconnect refresh) — and
	// would then yank them out of their empty thread into the newest one.
	const mergedSeeded = useRef(false);
	useEffect(() => {
		if (!mergedAgentId || mergedSeeded.current || merged.threads.length === 0) {
			return;
		}
		mergedSeeded.current = true;
		if (convId) {
			return;
		}
		setConvId(merged.threads[0].id);
	}, [mergedAgentId, convId, merged.threads]);

	// Mirror THIS tab's conversation into the shared context whenever it is the
	// focused tab, so the sidebar highlight + goal/fork/double-check target the
	// conversation the user is actually looking at. Tab *content* is driven by
	// the local `convId`, not this shared mirror, so background tabs never fight
	// over it (e.g. tab-strip switching shows each tab's own thread).
	const isActiveTab = useIsActiveTab();
	const isActiveTabRef = useRef(isActiveTab);
	isActiveTabRef.current = isActiveTab;
	useEffect(() => {
		if (isActiveTab) {
			setActiveConversationId(convId);
		}
	}, [isActiveTab, convId, setActiveConversationId]);

	const activeNode = useActiveNode();
	const chatTarget: ApiTarget = useMemo(
		() => ({ url: activeNode.url, token: activeNode.token ?? null }),
		[activeNode.url, activeNode.token]
	);

	// Ryu Apps widget host (U7). The desktop is the TRUSTED side: it holds the Core
	// token and performs the Gateway-governed round-trips on a widget's behalf. The
	// context value carries the WidgetRenderer slot (AppWidget) + node-scoped
	// services; `@ryu/blocks`'s tool-renderer reads it to mount a widget for a
	// `data-tool-widget-available` part.
	const widgetHostValue = useMemo<WidgetHostValue>(() => {
		const services: WidgetHostServices = {
			callTool: (input) => widgetCallTool(chatTarget, input),
			sendFollowUpMessage: (input) => widgetFollowUp(chatTarget, input),
			setWidgetState: (input) => widgetSetState(chatTarget, input),
		};
		return {
			// The two shell facts the shared renderer can't derive: how this app
			// opens a real browser, and which node origin proxies widget assets.
			env: {
				openExternal: (href: string) => openExternal(href),
				proxyOrigin: chatTarget.url,
			},
			Renderer: AppWidget,
			services,
		};
	}, [chatTarget]);

	// Voice input: a stable transcribe fn (reads the live node target via a ref)
	// passed into the composer's mic button. Stable identity keeps the memoized
	// InputBar slot from remounting and dropping textarea focus.
	const chatTargetRef = useRef(chatTarget);
	chatTargetRef.current = chatTarget;
	const composerBlockedRef = useRef(false);
	composerBlockedRef.current = composerBlocked;

	// Active model's context window (tokens), used as the denominator for the
	// per-message context-usage ring in each assistant turn's stats footer.
	// Resolved from the model's launch config; `undefined` (auto / unknown) ⇒
	// no ring, mirroring Jan's "hide when n_ctx unknown". Keyed on the primitive
	// model id (not the `chatTarget` object) to avoid a deps-driven render loop.
	const [contextSize, setContextSize] = useState<number | undefined>(undefined);
	useEffect(() => {
		if (!effectiveModel) {
			setContextSize(undefined);
			return;
		}
		let cancelled = false;
		(async () => {
			const target = chatTargetRef.current;
			const cfg = await getModelLaunchConfig(target, effectiveModel);
			if (cancelled) {
				return;
			}
			if (cfg.ctx_size && cfg.ctx_size > 0) {
				setContextSize(cfg.ctx_size);
				return;
			}
			// ACP / cloud models: local launch config has no ctx_size — resolve
			// from models.dev so the composer's context ring has a denominator.
			const fromCatalog = await getModelContextWindow(target, effectiveModel);
			if (!cancelled) {
				setContextSize(
					fromCatalog && fromCatalog > 0 ? fromCatalog : undefined
				);
			}
		})().catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [effectiveModel]);
	const voiceTranscribe = useCallback(
		(audio: Blob) => transcribeAudio(chatTargetRef.current, audio),
		[]
	);

	// #415: Load the conversation's participants so assistant messages can still be
	// labelled per-agent. (The in-composer "add agent" control was removed in favour
	// of agent teams, but legacy multi-agent conversations keep their attribution.)
	useEffect(() => {
		if (!convId) {
			setParticipants([]);
			return;
		}
		let cancelled = false;
		fetchParticipants(chatTarget, convId).then((list) => {
			if (!cancelled) {
				setParticipants(list);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [convId, chatTarget]);

	// Keep the latest opt-in value reachable from the transport body closure,
	// which is created once and would otherwise capture a stale value.
	const longTermMemoryRef = useRef(longTermMemory);
	useEffect(() => {
		longTermMemoryRef.current = longTermMemory;
		localStorage.setItem("ryu_long_term_memory", String(longTermMemory));
	}, [longTermMemory]);

	// Stable draft ID so useChat keeps the same id on first send (state update is async)
	const draftConvId = useRef(`conv-${Date.now()}`);
	const chatId = convId ?? draftConvId.current;
	// Latest convId reachable from the once-created transport body closure below.
	const convIdRef = useRef<string | null>(convId);
	convIdRef.current = convId;

	// #403: Tracks user messages that were blocked so they still appear in the
	// thread even when the send is prevented.
	const [blockedMessages, setBlockedMessages] = useState<
		Array<{ id: string; content: string; timestamp: number }>
	>([]);

	// ── Goal + Double-check are now plugins (io.ryu.goal / io.ryu.double-check) ──
	// driven by the Core plugin turn-hook runtime. The goal loop runs server-side
	// (type `/goal <condition>` in chat; the plugin parses + pursues it), and the
	// double-check review streams back as a `data-plugin_note` part. The desktop
	// carries no plugin-specific composer state: double-check is a plain composer
	// control contributed by its plugin manifest, so it flows through the generic
	// `pluginFlags` map below like every other composer toggle.

	// Generic plugin composer toggles (`composer_controls`): a flag→on map keyed by
	// each control's `flag`. Held in state (drives the toggle's rendered `enabled`)
	// plus a ref the once-created transport body closure reads when merging the
	// per-request `plugin_flags` — same pattern as the double-check flag above.
	const [pluginFlags, setPluginFlags] = useState<Record<string, boolean>>({});
	const pluginFlagsRef = useRef<Record<string, boolean>>({});
	pluginFlagsRef.current = pluginFlags;

	// One-shot flags marked by an `action` composer control when it fires. Kept in
	// a ref rather than state (the button holds no visual state) and CONSUMED by
	// the next request's body, exactly like `skipNextUserAppendRef`: a button press
	// belongs to the turn it precedes, not to every turn after it.
	const pendingActionFlagsRef = useRef<Record<string, boolean>>({});
	const firePluginActionFlag = useCallback((flag: string) => {
		pendingActionFlagsRef.current = {
			...pendingActionFlagsRef.current,
			[flag]: true,
		};
	}, []);

	// Ghost (temporary) chat: when on, every turn is sent with `persist: false` so
	// Core writes nothing to the conversation store, and a new ghost chat is never
	// registered in the sidebar history — it lives only in this tab's memory and is
	// gone on close or when a fresh chat starts. Ryu's incognito thread. A ref
	// mirrors the toggle so the once-created transport body closure reads the live
	// value (same pattern as the double-check flag above).
	// Seeded from the tab when the launchpad's "+" turned it on before this thread
	// existed, so the very first turn is already unsaved (flipping it after mount
	// would be too late — the turn would have persisted).
	const [ghostMode, setGhostMode] = useState(Boolean(initialGhost));
	const ghostModeRef = useRef(false);
	ghostModeRef.current = ghostMode;

	// Write this tab's thread back onto its Tab record. A tab opened blank ("New
	// chat") only learns its conversation id on the first send, and nothing used
	// to tell TabsContext — so the tab stayed unbound for its whole life:
	// session restore reopened it EMPTY (the thread was only reachable from the
	// sidebar), and a sidebar click on that same thread missed `openTab`'s
	// conversation dedup and stacked a SECOND tab on it. Two chat tabs on one
	// conversation share a single `useChat({ id })` instance, so the late mount's
	// blank state clobbers the live one and both stop updating — the "opened it
	// again and the new tab is broken" report.
	//
	// A ghost (temporary) thread never binds: it must leave no durable trace, and
	// a persisted binding would restore a tab pointing at a conversation Core
	// never wrote. Unbinding is equally load-bearing — a tab that starts a fresh
	// thread must drop its old id, or a click on the OLD conversation would dedup
	// onto a tab that is showing something else.
	//
	// The binding carries the id only, never a title: the tab label already has a
	// single writer (`useTitleBar` → `updateTabTitle`, below), and a second one
	// here would race it for ghost threads ("Temporary chat" vs the default).
	const boundConversationId = ghostMode ? undefined : (convId ?? undefined);
	useEffect(() => {
		if (!currentTabId) {
			return;
		}
		bindTabConversation(currentTabId, boundConversationId);
	}, [currentTabId, boundConversationId, bindTabConversation]);

	// Plugin notes (e.g. the double-check review) arrive as `data-plugin_note`
	// stream parts; dismissed ids are tracked so a note clears once acknowledged.
	const [dismissedPluginNotes, setDismissedPluginNotes] = useState<Set<string>>(
		() => new Set()
	);

	const {
		messages,
		sendMessage,
		setMessages,
		regenerate,
		stop,
		status,
		error,
		clearError,
	} = useChat({
		id: chatId,
		transport: new DefaultChatTransport({
			api: chatStreamUrl(chatTarget),
			// Developer-mode turn timing (time-to-first-token, stream duration,
			// bytes). A plain `fetch` when metrics are off — see lib/dev-metrics.ts.
			fetch: instrumentedFetch,
			// Forward the user-identity JWT alongside the node token so Core can
			// verify WHO sent this turn and stamp `author_user_id` on the persisted
			// message — the value the realtime fan-out uses to attribute it to a
			// human for other viewers. `null` when signed out: no header, anonymous
			// turn (author stays NULL), single-user flow unchanged.
			headers: async (): Promise<Record<string, string>> => {
				const base = chatHeaders(chatTarget);
				const jwt = await getRealtimeJwt();
				return jwt ? { ...base, "X-Ryu-User-Jwt": jwt } : base;
			},
			body: () => {
				const ws = useWorkspaceStore.getState();
				const cwd = ws.folder ?? undefined;
				// Consume the one-shot skip flag: read then immediately reset so it
				// applies to exactly this request (the edit/regenerate re-run) and no
				// subsequent normal send.
				const skipUserAppend = skipNextUserAppendRef.current;
				skipNextUserAppendRef.current = false;
				// Same consume-once treatment for the flags an `action` composer
				// control marked when it fired: they belong to this turn, and leaving
				// them set would make the owning plugin's hook act on every later one.
				const firedActionFlags = pendingActionFlagsRef.current;
				pendingActionFlagsRef.current = {};
				// Persistent-session worktree: opt-in via the workspace bar's run
				// mode (not auto-on per folder). When enabled, Core creates an
				// isolated worktree on the first message and reuses it across turns,
				// capturing the aggregate diff (fetched by DiffReviewPane).
				const useWorktree = Boolean(cwd) && ws.worktreeMode;
				return {
					agent_id: agentId,
					conversation_id: convIdRef.current ?? draftConvId.current,
					// A ghost (temporary) chat must leave no durable trace, so it never
					// records the turn into long-term cross-session memory — regardless of
					// the user's standing long-term-memory preference.
					enable_long_term: ghostModeRef.current
						? false
						: longTermMemoryRef.current,
					cwd,
					worktree_isolation: useWorktree,
					// Desired branch for the worktree Core creates on the first turn
					// (sanitized server-side; ignored when reusing an existing one).
					worktree_branch: useWorktree ? ws.worktreeBranch : undefined,
					// #415: Pass the @mention target agent id when the user directed the
					// message at a specific conversation participant.
					target_agent_id: targetAgentIdRef.current ?? undefined,
					// When the user @-mentioned a team, Core fans out to its members.
					// The transient mention wins for one send; otherwise the persistent
					// composer team pick applies.
					team_id: teamIdRef.current ?? composerTeamIdRef.current ?? undefined,
					// When the user @-mentioned a workflow, Core runs it with this
					// message as its chat input. Resets after each send. A workflow
					// target is the most specific intent, so it is sent alongside
					// (Core's `workflow_id` branch ignores agent/team).
					workflow_id: workflowIdRef.current ?? undefined,
					// Composer model picker selection (per-agent). Core routes honour it
					// where the transport supports a model override; otherwise ignored.
					model: selectedModelRef.current ?? undefined,
					// ACP session controls (agent-reported). Re-applied to this turn's
					// ACP session by Core; ignored by non-ACP routes.
					acp_mode: acpModeRef.current ?? undefined,
					acp_config:
						acpOptionValuesRef.current &&
						Object.keys(acpOptionValuesRef.current).length > 0
							? acpOptionValuesRef.current
							: undefined,
					acp_model: acpModelRef.current ?? undefined,
					// Per-request plugin flags (every plugin-contributed composer toggle,
					// double-check included). The plugin turn-hook runtime passes these to
					// each hook; a plugin acts only when its flag is set.
					plugin_flags: buildPluginFlags({
						...pluginFlagsRef.current,
						...firedActionFlags,
					}),
					// Ghost (temporary) chat: never write this turn to the conversation
					// store. Omitted otherwise so Core applies its default (persist=true).
					persist: ghostModeRef.current ? false : undefined,
					// Version-tree edit/regenerate re-run: the edited user sibling is
					// already persisted (edit route) or a regenerate carries no new user
					// turn, so Core must not re-append the trailing user message. The ref
					// is set true just before the regenerate() trigger and consumed here.
					skip_user_append: skipUserAppend || undefined,
				};
			},
		}),
	});

	// Feeds the session-control pick notice above, which is defined before this
	// hook (it is passed into the composer's ACP sections) and so cannot read
	// `status` directly.
	turnInFlightRef.current = status === "streaming" || status === "submitted";

	// Per-message send time (ms), keyed by message id. Persisted history seeds this
	// with Core's server-stamped `created_at`; live turns (which arrive over the SSE
	// stream without a timestamp) get a client stamp the first time they're seen.
	// Kept out of useChat's own message state so nothing extra is POSTed back to Core
	// on the next turn — `processedMessages` reads from here to render the toolbar.
	const messageSentAtRef = useRef<Map<string, number>>(new Map());

	// Multimodal: generate an image from the composer text and surface it inline as
	// an assistant message. The result is client-only — Core's /api/images/generate
	// is one-shot and isn't written to the conversation store, so the image is not
	// re-hydrated on reload (loadMessages rebuilds history as text-only parts).
	// The generation itself, against an assistant message that ALREADY exists.
	// Split out from the handler below so a failed generation can be re-run in
	// place (see `handleRetryGeneration`) instead of echoing the prompt a second
	// time. Core has no progress events for this path, so the status goes straight
	// from `generating` to `complete`/`error` — no fabricated intermediate steps.
	const runImageGeneration = useCallback(
		async (assistantId: string, prompt: string) => {
			const settle = (parts: unknown[]) => {
				setMessages((prev) =>
					prev.map((m) =>
						m.id === assistantId ? ({ ...m, parts } as typeof m) : m
					)
				);
			};
			// Back to the in-flight frame first: on a retry the message still holds
			// the failed part, and the frame must reserve its box again.
			settle([
				{
					type: "data-image-generation",
					data: { status: "generating", prompt },
				},
			]);
			try {
				const urls = await generateImage(chatTargetRef.current, prompt);
				const [first, ...rest] = urls;
				if (!first) {
					settle([
						{
							type: "data-image-generation",
							data: {
								status: "error",
								prompt,
								statusText: "The image engine returned no image.",
							},
						},
					]);
					return;
				}
				// The first image drives the generation surface; any extras (n > 1)
				// ride along as plain file parts, which render in the same frame.
				settle([
					{
						type: "data-image-generation",
						data: { status: "complete", prompt, url: first },
					},
					...rest.map((url) => ({
						type: "file",
						mediaType: "image/png",
						url,
					})),
				]);
			} catch (e) {
				settle([
					{
						type: "data-image-generation",
						data: {
							status: "error",
							prompt,
							statusText:
								e instanceof Error ? e.message : "Could not generate image.",
						},
					},
				]);
			}
		},
		[setMessages]
	);

	const handleGenerateImage = useCallback(
		async (prompt: string) => {
			const userId = `img-user-${Date.now()}`;
			const assistantId = `img-${Date.now()}`;
			// Echo the prompt as a user bubble, and reserve the image frame in the
			// same tick: MessageList renders a `data-image-generation` part through
			// the ImageGeneration surface, so the turn shows the generation running
			// and the finished image fades into an already-sized frame.
			setMessages((prev) => [
				...prev,
				{
					id: userId,
					role: "user",
					parts: [{ type: "text", text: prompt }],
				} as (typeof prev)[number],
				{
					id: assistantId,
					role: "assistant",
					parts: [
						{
							type: "data-image-generation",
							data: { status: "generating", prompt },
						},
					],
				} as unknown as (typeof prev)[number],
			]);
			await runImageGeneration(assistantId, prompt);
		},
		[runImageGeneration, setMessages]
	);

	// The video twin of `runImageGeneration`, on the matching
	// `data-video-generation` part. The sdcpp vid_gen response shape is
	// best-effort (see lib/api/video.ts) — an empty result keeps the frame and
	// says which model to load, rather than dropping a bare error card.
	const runVideoGeneration = useCallback(
		async (assistantId: string, prompt: string) => {
			const settle = (parts: unknown[]) => {
				setMessages((prev) =>
					prev.map((m) =>
						m.id === assistantId ? ({ ...m, parts } as typeof m) : m
					)
				);
			};
			settle([
				{
					type: "data-video-generation",
					data: { status: "generating", prompt },
				},
			]);
			try {
				const clips = await generateVideo(chatTargetRef.current, prompt);
				const [first, ...rest] = clips;
				if (!first) {
					settle([
						{
							type: "data-video-generation",
							data: {
								status: "error",
								prompt,
								statusText:
									"The engine returned no video. Load a video model (Wan/LTX) in the sdcpp engine and try again.",
							},
						},
					]);
					return;
				}
				// Same split as images: the first clip drives the generation surface,
				// extras ride along as file parts (which render in the same frame).
				settle([
					{
						type: "data-video-generation",
						data: { status: "complete", prompt, url: first.url },
					},
					...rest.map((clip) => ({
						type: "file",
						mediaType: clip.mediaType,
						url: clip.url,
					})),
				]);
			} catch (e) {
				settle([
					{
						type: "data-video-generation",
						data: {
							status: "error",
							prompt,
							statusText:
								e instanceof Error ? e.message : "Could not generate video.",
						},
					},
				]);
			}
		},
		[setMessages]
	);

	// Multimodal: generate a video from the composer text, surfaced inline exactly
	// like the image path. Client-only (not persisted).
	const handleGenerateVideo = useCallback(
		async (prompt: string) => {
			const userId = `vid-user-${Date.now()}`;
			const assistantId = `vid-${Date.now()}`;
			setMessages((prev) => [
				...prev,
				{
					id: userId,
					role: "user",
					parts: [{ type: "text", text: prompt }],
				} as (typeof prev)[number],
				{
					id: assistantId,
					role: "assistant",
					parts: [
						{
							type: "data-video-generation",
							data: { status: "generating", prompt },
						},
					],
				} as unknown as (typeof prev)[number],
			]);
			await runVideoGeneration(assistantId, prompt);
		},
		[runVideoGeneration, setMessages]
	);

	// Retry a FAILED inline generation. Not `handleRegenerateMessage`: that one
	// branches a persisted turn server-side, and these parts are client-only (Core
	// never wrote them to the conversation store), so there is nothing to branch.
	// The narrowest correct call is re-running the same generator against the same
	// assistant message — no second user echo, no new bubble.
	const handleRetryGeneration = useCallback(
		(messageId: string, kind: "image" | "video", prompt: string) => {
			const run = kind === "video" ? runVideoGeneration : runImageGeneration;
			void run(messageId, prompt);
		},
		[runImageGeneration, runVideoGeneration]
	);

	// Speak an assistant reply aloud via Core's /api/voice/speak, honouring the
	// Voice-tab TTS engine/voice (localStorage). Playback uses a plain
	// HTMLAudioElement; the URL is revoked on end to free the blob.
	const speakingAudioRef = useRef<HTMLAudioElement | null>(null);
	// The text of the turn currently playing, so a second click on the SAME turn
	// stops it (toggle) rather than restarting — `audio.play()` resolves at playback
	// start, so SpeakButton re-enables mid-playback and the second click lands here.
	const speakingTextRef = useRef<string | null>(null);
	const handleSpeak = useCallback(async (text: string) => {
		const trimmed = text.trim();
		if (!trimmed) {
			return;
		}
		// Stop any in-flight playback so a second click doesn't overlap; if it was the
		// same turn, this is a toggle-off — return without starting a new synthesis.
		if (speakingAudioRef.current) {
			const wasSameTurn = speakingTextRef.current === trimmed;
			speakingAudioRef.current.pause();
			speakingAudioRef.current = null;
			speakingTextRef.current = null;
			if (wasSameTurn) {
				return;
			}
		}
		const prefs = getDesktopTtsPrefs();
		const blob = await speakText(chatTargetRef.current, trimmed, {
			engine: prefs.engine,
			voice: prefs.voice || undefined,
		});
		const url = URL.createObjectURL(blob);
		const audio = new Audio(url);
		speakingAudioRef.current = audio;
		speakingTextRef.current = trimmed;
		audio.addEventListener("ended", () => {
			URL.revokeObjectURL(url);
			if (speakingAudioRef.current === audio) {
				speakingAudioRef.current = null;
				speakingTextRef.current = null;
			}
		});
		await audio.play();
	}, []);
	const handleSpeakRef = useRef(handleSpeak);
	handleSpeakRef.current = handleSpeak;
	const desktopTts = getDesktopTtsPrefs();
	// ChatGPT-style continuous voice mode (its own separate entry point — the
	// composer mic above stays as push-to-talk voice INPUT). All realtime logic
	// (VAD, endpointing, barge-in) lives in Core; this reflects it into the overlay.
	const voiceMode = useVoiceMode(chatTarget, {
		conversationId: activeConversationId ?? undefined,
		ttsEngine: desktopTts.engine,
		ttsVoice: desktopTts.voice || undefined,
	});

	// Interactive ACP tool-permission prompts. When an agent in a gating mode
	// asks to run a tool, Core streams a `data-ryu-permission` part; we surface
	// the latest unresolved one above the composer and POST the user's choice
	// back (`/api/chat/permission`) to unblock the awaiting turn. Resolved request
	// ids are tracked so the prompt clears once answered.
	const [resolvedPermissions, setResolvedPermissions] = useState<Set<string>>(
		() => new Set()
	);
	const activePermission = useMemo<ActivePermission | null>(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "assistant" || !m.parts) {
				continue;
			}
			for (let j = m.parts.length - 1; j >= 0; j--) {
				const part = m.parts[j] as { type?: string; data?: unknown };
				if (part?.type !== "data-ryu-permission") {
					continue;
				}
				const data = part.data as ActivePermission | undefined;
				if (data?.requestId && !resolvedPermissions.has(data.requestId)) {
					return data;
				}
			}
		}
		return null;
	}, [messages, resolvedPermissions]);

	// Deliver a decision for one permission request. Split out of
	// `handleRespondPermission` (which only ever knows about the composer's
	// latest prompt) so the inline approval on a tool row can answer the exact
	// request that gates *that* call.
	const respondToPermission = useCallback(
		(requestId: string, optionId: string | null) => {
			setResolvedPermissions((prev) => {
				if (prev.has(requestId)) {
					return prev;
				}
				const next = new Set(prev);
				next.add(requestId);
				return next;
			});
			respondPermission(chatTargetRef.current, requestId, optionId).catch(
				() => {
					// Optimistically cleared already; a failed POST just means the
					// request had already timed out/resolved server-side.
				}
			);
		},
		[]
	);

	// Every unresolved permission request, keyed by the tool call it gates. The
	// `toolCall` payload is the ACP `ToolCallUpdate` Core forwarded verbatim, so
	// its `toolCallId` is the SAME id the tool part was opened under — that is
	// what lets the approval render on the tool row instead of floating free.
	const permissionsByToolCall = useMemo(() => {
		const out = new Map<string, ActivePermission>();
		for (const m of messages) {
			if (m.role !== "assistant" || !m.parts) {
				continue;
			}
			for (const part of m.parts) {
				const p = part as { type?: string; data?: unknown };
				if (p.type !== "data-ryu-permission") {
					continue;
				}
				const data = p.data as ActivePermission | undefined;
				if (!data?.requestId || resolvedPermissions.has(data.requestId)) {
					continue;
				}
				const tc = data.toolCall as
					| { toolCallId?: unknown; tool_call_id?: unknown }
					| null
					| undefined;
				const toolCallId =
					typeof tc?.toolCallId === "string"
						? tc.toolCallId
						: typeof tc?.tool_call_id === "string"
							? tc.tool_call_id
							: null;
				if (toolCallId) {
					out.set(toolCallId, data);
				}
			}
		}
		return out;
	}, [messages, resolvedPermissions]);

	// The inline approval on the tool row is the primary surface. The composer
	// prompt stays as the fallback for a request whose tool call has no row in
	// the thread — otherwise the same question is asked twice, in two places.
	const composerPermission = useMemo<ActivePermission | null>(() => {
		if (!activePermission) {
			return null;
		}
		for (const m of messages) {
			if (m.role !== "assistant" || !m.parts) {
				continue;
			}
			for (const part of m.parts) {
				const p = part as { type?: string; toolCallId?: string };
				const isTool =
					p.type === "dynamic-tool" ||
					(typeof p.type === "string" && p.type.startsWith("tool-"));
				if (!(isTool && p.toolCallId)) {
					continue;
				}
				if (
					permissionsByToolCall.get(p.toolCallId)?.requestId ===
					activePermission.requestId
				) {
					return null;
				}
			}
		}
		return activePermission;
	}, [activePermission, messages, permissionsByToolCall]);

	// Slash commands contributed by enabled Core plugins (e.g. `/proof` from the
	// proof-of-work turn-hook plugin). Core tags each with its owning `plugin` id
	// and returns the full `command` text (leading "/"); the popover works off the
	// bare name, so strip it. These are plain messages at submit time — Core's
	// turn-hook interprets them — so nothing client-side handles them here.
	const pluginContributions = usePluginContributions();
	const pluginSlashCommands = useMemo<SlashCommand[]>(() => {
		const out: SlashCommand[] = [];
		for (const entry of pluginContributions.slash_commands) {
			const rec = entry as {
				command?: unknown;
				description?: unknown;
				body?: unknown;
			};
			if (typeof rec.command !== "string") {
				continue;
			}
			const name = rec.command.replace(/^\//, "").trim();
			if (!name) {
				continue;
			}
			// A `body` marks an imported user command (a Codex prompt): it expands
			// into the prompt template when selected, instead of inserting "/name ".
			const body =
				typeof rec.body === "string" && rec.body.trim() ? rec.body : undefined;
			out.push({
				name,
				description: typeof rec.description === "string" ? rec.description : "",
				hint: null,
				source: body ? "user" : "plugin",
				body,
			});
		}
		return out;
	}, [pluginContributions.slash_commands]);

	// Contributed per-message toolbar actions (`contributes.message_actions`),
	// passed into blocks presentationally. The shell dispatches each through the
	// owning plugin's granted host seam when fired.
	const contributedMessageActions = useMemo(() => {
		return pluginContributions.message_actions.map((a) => ({
			id: a.id,
			label: a.label,
			icon: a.icon,
			kind: a.kind,
			target: a.target,
			states: a.states,
			capability: a.capability,
			plugin: a.plugin,
		}));
	}, [pluginContributions.message_actions]);

	const handleContributedMessageAction = useCallback(
		(
			action: {
				capability?: string;
				icon?: string;
				id: string;
				kind: string;
				label: string;
				plugin: string;
				states?: {
					active_icon?: string;
					icon?: string;
					label: string;
					value: string;
				}[];
				target: string;
			},
			_value?: string
		) => {
			if (!(action.plugin && action.capability)) {
				return;
			}
			void pluginHostInvoke(chatTarget, action.plugin, action.capability, {});
		},
		[chatTarget]
	);

	// Slash commands the active agent advertised over ACP. Core streams the full
	// list (each update replaces the last) as a `data-ryu-acp-commands` part; we
	// take the most recent one across the thread. Combined with Ryu's own local
	// commands and enabled plugins' contributed commands to drive the composer's
	// "/" popover. Plugin commands are deduped by name against ACP + local ones,
	// which win.
	const composerCommands = useMemo<SlashCommand[]>(() => {
		const withPlugins = (base: SlashCommand[]): SlashCommand[] => {
			const seen = new Set(base.map((c) => c.name));
			const extra = pluginSlashCommands.filter((c) => !seen.has(c.name));
			return [...base, ...extra];
		};
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "assistant" || !m.parts) {
				continue;
			}
			for (let j = m.parts.length - 1; j >= 0; j--) {
				const part = m.parts[j] as { type?: string; data?: unknown };
				if (part?.type !== "data-ryu-acp-commands") {
					continue;
				}
				const data = part.data as
					| {
							commands?: {
								name: string;
								description?: string;
								hint?: string;
							}[];
					  }
					| undefined;
				if (!data?.commands) {
					continue;
				}
				const agentCommands: SlashCommand[] = data.commands.map((c) => ({
					name: c.name,
					description: c.description ?? "",
					hint: c.hint ?? null,
					source: "agent",
				}));
				return withPlugins([...agentCommands, ...LOCAL_SLASH_COMMANDS]);
			}
		}
		return withPlugins(LOCAL_SLASH_COMMANDS);
	}, [messages, pluginSlashCommands]);

	// Agent-initiated Session Mode changes. Core streams the new active mode as a
	// `data-ryu-acp-mode` part (`{ currentModeId }`); we take the most recent one
	// and push it into ChatPage's `streamedAcpMode` state, which the composer hook
	// adopts as the Approval picker's selection (and persists for the agent).
	const latestStreamedAcpMode = useMemo<string | null>(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "assistant" || !m.parts) {
				continue;
			}
			for (let j = m.parts.length - 1; j >= 0; j--) {
				const part = m.parts[j] as { type?: string; data?: unknown };
				if (part?.type !== "data-ryu-acp-mode") {
					continue;
				}
				const data = part.data as { currentModeId?: string } | undefined;
				const modeId = data?.currentModeId?.trim();
				if (modeId) {
					return modeId;
				}
			}
		}
		return null;
	}, [messages]);
	useEffect(() => {
		if (latestStreamedAcpMode) {
			setStreamedAcpMode(latestStreamedAcpMode);
		}
	}, [latestStreamedAcpMode]);

	// The agent refused a turn because its login lapsed (Core's
	// `data-ryu-acp-auth-required`, raised from JSON-RPC -32000). Core deliberately
	// does NOT send this down the error path: that one tears the turn down with
	// advice about configuring a model, which cannot fix an expired OAuth token
	// and hides the real cause.
	//
	// Surfaced as an actionable toast rather than an inline block: the recovery is
	// a single login the desktop already owns, and the turn can simply be re-run
	// afterwards. Keyed on the emitting part so one lapse prompts once, not on
	// every re-render of the transcript.
	const authPromptedRef = useRef<string | null>(null);
	const latestAuthRequired = useMemo<{
		agentId: string;
		key: string;
		message: string;
	} | null>(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "assistant" || !m.parts) {
				continue;
			}
			for (let j = m.parts.length - 1; j >= 0; j--) {
				const part = m.parts[j] as { type?: string; data?: unknown };
				if (part?.type !== "data-ryu-acp-auth-required") {
					continue;
				}
				const data = part.data as
					| { agentId?: string; message?: string }
					| undefined;
				if (data?.agentId) {
					return {
						agentId: data.agentId,
						message: data.message ?? "",
						key: `${m.id}:${j}`,
					};
				}
			}
		}
		return null;
	}, [messages]);
	useEffect(() => {
		if (
			!latestAuthRequired ||
			authPromptedRef.current === latestAuthRequired.key
		) {
			return;
		}
		authPromptedRef.current = latestAuthRequired.key;
		const { agentId: staleAgent } = latestAuthRequired;
		let cancelled = false;
		// Ask the agent which login methods it advertises before offering one —
		// the method id is agent-specific and there is no useful default.
		fetchAcpConfig(chatTarget, staleAgent)
			.then((cfg) => {
				if (cancelled) {
					return;
				}
				const method = cfg?.authMethods?.[0];
				if (!method) {
					toast.error({
						title: "The agent needs you to log in again",
						description:
							latestAuthRequired.message ||
							"Its session expired, and it advertises no login method.",
					});
					return;
				}
				toast.warning({
					title: "Your agent login expired",
					description: "Log in again, then re-send your message.",
					// Held open: a login prompt that auto-dismisses while the user is
					// reading it leaves them with a dead turn and no explanation.
					duration: null,
					button: {
						title: method.name ?? "Log in",
						onClick: () => {
							authenticateAgent(chatTarget, staleAgent, method.id)
								.then((res) => {
									if (res.authenticated) {
										toast.success({ title: "Logged back in" });
									} else {
										toast.error({ title: "Login did not complete" });
									}
								})
								.catch(() => {
									toast.error({ title: "Login failed" });
								});
						},
					},
				});
			})
			.catch(() => {
				if (!cancelled) {
					toast.error({
						title: "The agent needs you to log in again",
						description: latestAuthRequired.message || undefined,
					});
				}
			});
		return () => {
			cancelled = true;
		};
	}, [latestAuthRequired, chatTarget]);

	// The agent's config option DEFINITIONS, re-published on the live stream as
	// `data-ryu-acp-config-options` (`{ configOptions }`). Most recent part wins
	// and REPLACES the set wholesale, the same contract as the slash-command list
	// above — an option missing from a refreshed list is one the agent has
	// withdrawn, so merging would keep a stale picker alive forever.
	const latestStreamedAcpConfigOptions = useMemo<
		AcpConfigOption[] | null
	>(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "assistant" || !m.parts) {
				continue;
			}
			for (let j = m.parts.length - 1; j >= 0; j--) {
				const part = m.parts[j] as { type?: string; data?: unknown };
				if (part?.type !== "data-ryu-acp-config-options") {
					continue;
				}
				const data = part.data as
					| { configOptions?: AcpConfigOption[] }
					| undefined;
				if (Array.isArray(data?.configOptions)) {
					return data.configOptions;
				}
			}
		}
		return null;
	}, [messages]);
	useEffect(() => {
		if (latestStreamedAcpConfigOptions) {
			setStreamedAcpConfigOptions(latestStreamedAcpConfigOptions);
		}
	}, [latestStreamedAcpConfigOptions]);
	// An option list belongs to the agent that published it. Switching agent (or
	// thread) must drop it, or the new agent's pickers would keep rendering the
	// previous agent's options — the memo above only ever SETS, so a stale value
	// would otherwise survive until something else published.
	// biome-ignore lint/correctness/useExhaustiveDependencies: agentId/convId are the reset triggers, not read in the body.
	useEffect(() => {
		setStreamedAcpConfigOptions(null);
	}, [agentId, convId]);

	// Agent-requested session-config write-backs, the exact same shape one level up
	// from the mode sync. Core streams `data-ryu-acp-config` (`{ config }`) when a
	// tool result asked the client to change values it holds and re-sends every
	// turn — an approved `ExitPlanMode` clearing the Plan mode pill is the shipped
	// case. Most recent part wins; the composer hook adopts and persists it.
	//
	// Carries the EMISSION key (`messageId:partIndex`), exactly like the config
	// warning below, because the identity that must be deduped is "this part", not
	// "this value": a second plan cycle in one conversation re-emits the byte-identical
	// `{"ryu.plan":"off"}`, and a value-keyed guard would swallow it and leave the
	// pill armed — the very bug this channel exists to fix. The key also preserves
	// what a value-keyed guard gave us: this memo re-runs on every stream chunk and
	// hands back a fresh object, but a later chunk re-derives the SAME key, so the
	// effect no-ops and a manual pick made mid-stream is never stomped.
	const latestStreamedAcpConfig = useMemo<StreamedAcpConfig | null>(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "assistant" || !m.parts) {
				continue;
			}
			for (let j = m.parts.length - 1; j >= 0; j--) {
				const part = m.parts[j] as { type?: string; data?: unknown };
				if (part?.type !== "data-ryu-acp-config") {
					continue;
				}
				const data = part.data as
					| { config?: Record<string, string> }
					| undefined;
				const config = data?.config;
				if (config && Object.keys(config).length > 0) {
					return { key: `${m.id}:${j}`, config };
				}
			}
		}
		return null;
	}, [messages]);
	const lastStreamedAcpConfigRef = useRef<string | null>(null);
	useEffect(() => {
		if (
			!latestStreamedAcpConfig ||
			latestStreamedAcpConfig.key === lastStreamedAcpConfigRef.current
		) {
			return;
		}
		lastStreamedAcpConfigRef.current = latestStreamedAcpConfig.key;
		setStreamedAcpConfig(latestStreamedAcpConfig);
	}, [latestStreamedAcpConfig]);

	// Non-fatal config warnings. Core streams `data-ryu-acp-config-warning` when a
	// session control the user chose (e.g. a model pick) was not accepted by the
	// agent. Surface the newest unseen one as a transient toast so the user isn't
	// silently misled. A ref tracks the last shown warning so re-renders don't
	// re-toast the same one.
	const lastConfigWarningRef = useRef<string | null>(null);
	const latestConfigWarning = useMemo<{
		key: string;
		message: string;
	} | null>(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "assistant" || !m.parts) {
				continue;
			}
			for (let j = m.parts.length - 1; j >= 0; j--) {
				const part = m.parts[j] as { type?: string; data?: unknown };
				if (part?.type !== "data-ryu-acp-config-warning") {
					continue;
				}
				const data = part.data as
					| { field?: string; message?: string; requested?: string }
					| undefined;
				const message = data?.message?.trim();
				if (message) {
					return { key: `${m.id}:${j}`, message };
				}
			}
		}
		return null;
	}, [messages]);
	useEffect(() => {
		if (
			latestConfigWarning &&
			latestConfigWarning.key !== lastConfigWarningRef.current
		) {
			lastConfigWarningRef.current = latestConfigWarning.key;
			toast.warning({
				title: "Agent didn't apply a setting",
				description: latestConfigWarning.message,
			});
		}
	}, [latestConfigWarning]);

	// The latest plugin note (e.g. the double-check review) streamed as a
	// `data-plugin_note` part and not yet dismissed. Surfaced in a dismissible
	// banner above the composer; it never enters chat history.
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: legacy component
	const activePluginNote = useMemo<{ id: string; text: string } | null>(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== "assistant" || !m.parts) {
				continue;
			}
			for (let j = m.parts.length - 1; j >= 0; j--) {
				const part = m.parts[j] as { type?: string; data?: unknown };
				if (part?.type !== "data-plugin_note") {
					continue;
				}
				const data = part.data as { text?: string } | undefined;
				const text = data?.text?.trim();
				if (!text) {
					continue;
				}
				const id = `${m.id}:${j}`;
				if (dismissedPluginNotes.has(id)) {
					return null;
				}
				return { id, text };
			}
		}
		return null;
	}, [messages, dismissedPluginNotes]);

	const handleRespondPermission = useCallback(
		(optionId: string | null) => {
			const requestId = activePermission?.requestId;
			if (!requestId) {
				return;
			}
			respondToPermission(requestId, optionId);
		},
		[activePermission, respondToPermission]
	);

	const permissionRef = useRef<{
		permission: ActivePermission | null;
		onRespond: (optionId: string | null) => void;
	}>({ permission: null, onRespond: handleRespondPermission });
	permissionRef.current = {
		permission: composerPermission,
		onRespond: handleRespondPermission,
	};

	// Slash-command list held in a ref so the memoized InputBar slot stays stable
	// (same pattern as permission/agents above — avoids textarea focus loss).
	const commandsRef = useRef<SlashCommand[]>(composerCommands);
	commandsRef.current = composerCommands;

	// Whether anything is on screen right now, read inside the async hydration
	// without making it a dependency: the point is what is true when the fetch
	// RESOLVES, and depending on `messages` would re-run the fetch on every token.
	const hasMessagesRef = useRef(false);
	hasMessagesRef.current = messages.length > 0;

	const retryHistoryLoad = useCallback(() => {
		setHistoryFailed(false);
		setHistoryReloadKey((n) => n + 1);
	}, []);

	// Hydrate the visible thread from Core's server-side store when switching
	// conversations, so history survives restarts and is shared across clients.
	// Switching `activeConversationId` changes `chatId`, which makes useChat
	// recreate its Chat with an empty message list (a fresh new/deleted/selected
	// thread starts blank). We then overlay any persisted history on top.
	//
	// The `history.length === 0` early-return is load-bearing: this effect also
	// fires during the first send (handleSend sets activeConversationId *before*
	// the message is persisted), when Core has nothing yet. Calling setMessages([])
	// on that empty result would wipe the just-sent user message and the streaming
	// reply, so we must leave useChat's own state untouched when there is no
	// server-side history.
	useEffect(() => {
		if (!convId) {
			// A brand-new chat has nothing to wait for — the greeting is correct here.
			setHistoryLoading(false);
			setHistoryFailed(false);
			return;
		}
		let cancelled = false;
		// Only claim "loading" when there is nothing on screen. This effect also
		// fires the moment the FIRST send adopts a conversation id, and blanking
		// the just-sent message behind a skeleton would be worse than the bug.
		if (!hasMessagesRef.current) {
			setHistoryLoading(true);
		}
		loadMessagesResult(convId).then(({ status, messages: history }) => {
			if (cancelled) {
				return;
			}
			setHistoryLoading(false);
			// A transport/HTTP failure is NOT an empty conversation. Leaving
			// useChat's state alone and flagging the failure is what keeps a chat
			// opened while Core is still booting from rendering as a new chat.
			if (status === "error") {
				setHistoryFailed(true);
				return;
			}
			setHistoryFailed(false);
			if (history.length === 0) {
				return;
			}
			// The user typed while the fetch was in flight (first send adopting this
			// id). Their message and its live reply outrank stale server history.
			if (hasMessagesRef.current) {
				return;
			}
			const now = Date.now();
			// Seed the send-time map with each persisted message's server timestamp so
			// the toolbar can render "when it was sent" on reload. Live turns fall back
			// to a client stamp in `processedMessages`.
			for (const h of history) {
				if (typeof h.timestamp === "number") {
					messageSentAtRef.current.set(h.id, h.timestamp);
				}
			}
			setVersions(buildVersions(history));
			setMessages(history.map((m) => hydrateHistoryMessage(m, now)));
		});
		return () => {
			cancelled = true;
		};
	}, [convId, loadMessagesResult, setMessages, historyReloadKey]);

	// Re-hydrate messages when the user switches back to this tab. If the ACP
	// agent is still running, reconnect to Core's live stream resume endpoint so
	// text deltas appear in real time. Otherwise just load persisted history.
	//
	// "error" re-hydrates alongside "ready": a turn whose stream died (Core
	// restarted, network dropped) leaves useChat parked in `error` forever, and
	// gating re-hydration on "ready" alone meant that tab NEVER refreshed again —
	// it showed the truncated thread for the rest of the session even though Core
	// had the finished turn persisted. There is no live stream to clobber in the
	// error state, so reloading is safe. (A turn stuck in "streaming" without a
	// terminal frame is still not re-hydrated — clobbering a genuinely live turn
	// would be worse.)
	//
	// Reloading history alone would leave the tab READ-ONLY: `handleComposerSubmit`
	// only sends on `status === "ready"` and otherwise parks the message in the
	// send queue, which drains on "ready" — so a chat stuck in `error` swallowed
	// every subsequent message. `clearError()` returns the Chat to "ready" once the
	// persisted thread is back on screen, which is also what drains that queue.
	//
	// Seeded `false`, not `isActiveTab`: seeding it from the live value meant the
	// mount pass counted as "was already active", so a tab that mounts on an
	// existing conversation NEVER attempted a resume. Reopening the app (or a
	// thread) while Core was mid-turn therefore showed a frozen partial reply and
	// an idle composer — no live text, no Stop — until the tab was toggled away
	// and back. A fresh chat has no `convId`, so this stays a no-op there.
	const prevIsActiveTab = useRef(false);
	const resumeAbort = useRef<AbortController | null>(null);
	// A resumed turn streams through `setMessages` below, NOT through `useChat`,
	// so its `status` stays "ready" for the whole reply — which left the composer
	// showing the idle trailing button (voice mode) with no Stop while text was
	// visibly arriving. Track the resumed stream explicitly and fold it into the
	// status handed to the chat surface so Stop appears for it too.
	const [resumeStreaming, setResumeStreaming] = useState(false);
	// True until this effect has taken its branch once. The mount pass must NOT
	// re-hydrate: the effect above already owns mount hydration, and its mapping
	// is the richer one (prefers structured `parts`, marks #404 stale-running
	// turns "⚠️ Interrupted", seeds `messageSentAtRef` with the server stamps).
	// Two hydrations racing on the same tab would let the lossy one win at random,
	// so on mount we read history only to seed the resume reader.
	// Keyed off the first effect INVOCATION, not the first time the branch is
	// taken: a tab that mounts on a fresh chat (no `convId`) skips the branch, so
	// a "first branch entry" flag would still read as the mount pass on a later
	// re-activation and skip the `clearError()` that un-sticks an error-parked
	// thread. Mount is the only pass that races the hydrator.
	const didMountPass = useRef(false);
	// True while a resume attempt (probe or attached reader) is outstanding. The
	// probe is now armed from three places instead of one, and without this guard
	// two of them can attach two readers to the same turn — which duplicates every
	// delta and leaves an orphaned reader running.
	const resumeInFlight = useRef(false);
	// Epoch ms until which resume probing is suppressed (set by an explicit Stop).
	const resumeSuppressedUntil = useRef(0);

	/**
	 * Probe `/api/chat/stream/resume/:id` and, if Core says a turn IS running,
	 * attach to it — which is what makes `effectiveStatus` (and therefore the
	 * composer's Stop button) report the truth.
	 *
	 * The 404-when-idle contract is what makes this safe to arm repeatedly: the
	 * server side is one in-memory registry lookup, so a probe against an idle
	 * conversation costs nothing. It is deliberately NOT derived from the
	 * conversation's persisted `run_status` — Core never reconciles that field at
	 * boot, so a crashed turn would leave the composer permanently showing Stop.
	 *
	 * `restore` also re-loads persisted history first (the tab-activation path,
	 * which must repaint the thread and `clearError()` whether or not a turn is
	 * live). `probe` touches nothing unless the probe actually attaches.
	 */
	const tryResume = useCallback(
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one SSE reader, kept whole
		async (mode: "restore" | "probe", options?: { hydrate?: boolean }) => {
			const conv = convIdRef.current;
			if (!conv || resumeInFlight.current) {
				return;
			}
			// An explicit Stop cancels the turn server-side, but Core takes a moment
			// to tear the live stream down. Without this window the poll below would
			// re-attach to the dying turn and flash Stop back on immediately after
			// the user pressed it.
			if (Date.now() < resumeSuppressedUntil.current) {
				return;
			}
			resumeInFlight.current = true;
			const controller = new AbortController();
			resumeAbort.current = controller;
			const hydrate = options?.hydrate ?? false;
			let attached = false;
			try {
				let history: Awaited<ReturnType<typeof loadMessages>> = [];
				if (mode === "restore") {
					history = await loadMessages(conv);
					if (controller.signal.aborted) {
						return;
					}
					if (history.length > 0 && hydrate) {
						setVersions(buildVersions(history));
						// The SAME mapper the mount pass uses. These two used to
						// disagree: this one mapped bare parts and dropped the
						// interruption marker, so a turn that was cut off came back
						// looking finished every time the tab was reopened.
						const now = Date.now();
						setMessages(history.map((m) => hydrateHistoryMessage(m, now)));
					}
					// Persisted state is on screen — take the chat out of `error` so the
					// composer (and any queued messages) work again. No-op when ready.
					if (hydrate) {
						clearError();
					}
				}

				// Try to reconnect to the running turn's live stream.
				const resumeUrl = chatStreamResumeUrl(chatTargetRef.current, conv);
				const headers = chatHeaders(chatTargetRef.current);
				const resp = await fetch(resumeUrl, {
					headers,
					signal: controller.signal,
				});
				if (!(resp.ok && resp.body)) {
					return; // 404 = no running turn
				}
				// A live turn IS attached — the composer must show Stop.
				attached = true;
				setResumeStreaming(true);
				if (mode === "probe") {
					// Only now is the history worth fetching: a bare probe must not cost
					// a conversation read on every tick.
					history = await loadMessages(conv);
					if (controller.signal.aborted) {
						return;
					}
				}
				const reader = resp.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";
				// Find the last assistant message id to append deltas to it,
				// or create a new one if none exists yet.
				const lastAssistant = history
					.slice()
					.reverse()
					.find((m) => m.role === "assistant");
				const targetMsgId = lastAssistant?.id ?? `resume-${Date.now()}`;
				// Start with the persisted text and append new deltas.
				let replyText = lastAssistant?.content ?? "";
				for (;;) {
					const { done, value } = await reader.read();
					if (done) {
						break;
					}
					buffer += decoder.decode(value, { stream: true });
					// Parse SSE frames (double-newline separated).
					let sep = buffer.indexOf("\n\n");
					while (sep !== -1) {
						const frame = buffer.slice(0, sep);
						buffer = buffer.slice(sep + 2);
						for (const line of frame.split("\n")) {
							if (!line.startsWith("data: ")) {
								continue;
							}
							const raw = line.slice(6).trim();
							if (raw === "[DONE]") {
								continue;
							}
							try {
								const parsed = JSON.parse(raw);
								if (parsed.type === "text-delta" && parsed.delta) {
									replyText += parsed.delta;
									setMessages((prev) => {
										const idx = prev.findIndex((m) => m.id === targetMsgId);
										if (idx !== -1) {
											const next = prev.slice();
											// Merge, never replace: the reader understands only
											// text-delta, so overwriting `parts` deleted the tool
											// rows, Thinking traces and stats part of a turn it
											// had merely reconnected to. The whole-message form
											// also clears `_interrupted`, which a delta disproves
											// — see mergeResumedReplyMessage.
											next[idx] = mergeResumedReplyMessage(
												next[idx],
												replyText
											);
											return next;
										}
										return [
											...prev,
											{
												id: targetMsgId,
												role: "assistant" as const,
												parts: [
													{
														type: "text" as const,
														text: replyText,
													},
												],
											},
										];
									});
								}
							} catch {
								// Ignore malformed frames.
							}
						}
						sep = buffer.indexOf("\n\n");
					}
				}
				// Stream ended — re-fetch the final persisted state.
				if (!controller.signal.aborted) {
					const final_ = await loadMessages(conv);
					if (final_.length > 0) {
						const now = Date.now();
						setMessages(final_.map((m) => hydrateHistoryMessage(m, now)));
					}
					refresh();
				}
			} catch {
				// Resume failed (no live turn / network error) — persisted history is
				// already loaded above, nothing more to do.
			} finally {
				resumeInFlight.current = false;
				setResumeStreaming(false);
				if (attached) {
					// Detaching flips `effectiveStatus` back to "ready", which re-arms
					// arm 2. Bound that cycle: if Core ever hands back a stream that
					// closes immediately, this makes it a slow retry rather than a
					// request storm.
					resumeSuppressedUntil.current = Date.now() + RESUME_REATTACH_GRACE_MS;
				}
			}
		},
		[loadMessages, setMessages, refresh, clearError]
	);

	// Arm 1 — tab activation (and mount). The original, and the only one that
	// re-hydrates history.
	useEffect(() => {
		const isMountPass = !didMountPass.current;
		didMountPass.current = true;
		const wasActive = prevIsActiveTab.current;
		prevIsActiveTab.current = isActiveTab;
		const settled = status === "ready" || status === "error";
		if (!wasActive && isActiveTab && settled && convId) {
			void tryResume("restore", { hydrate: !isMountPass });
		}
	}, [isActiveTab, status, convId, tryResume]);

	// Tear the reader down when the CONVERSATION changes (or the tab unmounts) —
	// not on every re-run of the effects above. The old cleanup lived on the
	// activation effect and fired on any dependency-identity churn, which aborted
	// a genuinely live resumed reader mid-reply.
	useEffect(
		() => () => {
			resumeAbort.current?.abort();
			resumeInFlight.current = false;
			setResumeStreaming(false);
		},
		[convId]
	);

	// The turn state everything user-facing keys off. `status` alone reports
	// "ready" through a whole resumed reply (that stream is ours, not useChat's),
	// which showed the composer as idle — no Stop, voice mode in the trailing
	// slot — and let a fresh send interleave with the running turn instead of
	// queueing behind it. Every consumer of "is a turn in flight" uses this;
	// `status` stays the raw useChat value for the stream plumbing itself.
	const effectiveStatus: typeof status =
		resumeStreaming && status === "ready" ? "streaming" : status;

	// Arm 2 — a stream of OURS just ended or errored. This is the case that made
	// a runaway turn unstoppable: a local SSE that drops mid-turn puts useChat
	// back at "ready"/"error" while Core keeps the turn running, and the one-shot
	// activation probe never fires again because the tab never lost focus. Edge-
	// triggered on the busy → settled transition, so dependency churn cannot turn
	// it into a loop.
	const prevSettledStatus = useRef<string>("ready");
	useEffect(() => {
		const previous = prevSettledStatus.current;
		prevSettledStatus.current = effectiveStatus;
		const wasBusy = previous === "streaming" || previous === "submitted";
		const settledNow =
			effectiveStatus === "ready" || effectiveStatus === "error";
		if (wasBusy && settledNow && convId && isActiveTab) {
			void tryResume("probe");
		}
	}, [effectiveStatus, convId, isActiveTab, tryResume]);

	// Arm 3 — a slow poll for turns this tab never started: a queued/scheduled
	// run, or the same conversation driven from another client. Only the focused
	// workspace tab of a focused WINDOW polls, and only while it believes it is
	// idle, so this is one cheap 404 every 15s for the chat the user is actually
	// looking at — not one per open tab.
	//
	// `document.hasFocus()`, not `visibilityState`: in the Tauri shell the page
	// stays "visible" while the window sits behind another app, so a visibility
	// check would poll forever for a window nobody is looking at.
	useEffect(() => {
		if (!(convId && isActiveTab) || effectiveStatus !== "ready") {
			return;
		}
		const id = window.setInterval(() => {
			if (document.hasFocus()) {
				void tryResume("probe");
			}
		}, RESUME_POLL_MS);
		return () => window.clearInterval(id);
	}, [convId, isActiveTab, effectiveStatus, tryResume]);

	// ── Multi-user collaboration (Phase 2): live chat fan-out + presence ────────
	// Join this conversation's realtime room (only once a real `convId` exists —
	// never the draft id) so another human's messages appear live and we can show
	// who is present/typing. Anonymous (no node JWT) still works: with no verified
	// author, nothing is attributed or live-inserted, leaving the single-user flow
	// untouched.
	//
	// The signed-in human (control-plane profile) — name/email for presence and a
	// secondary self-match key. Read into a ref so the realtime callbacks (created
	// once) always see the current value without re-subscribing.
	const oidcUser = useAppStore((s) => s.oidcUser);
	const myEmailRef = useRef<string | null>(null);
	myEmailRef.current = oidcUser?.email ?? null;

	// This client's stable Core user id (the JWT subject Core stamps as a message's
	// `author_user_id`). Resolved once; lets us tell our own echoed message from
	// someone else's. Null when signed out (anonymous) — then own/other is
	// indistinguishable, but an anonymous author is null too, so nothing inserts.
	const myUserIdRef = useRef<string | null>(null);
	const [myUserId, setMyUserId] = useState<string | null>(null);
	useEffect(() => {
		let cancelled = false;
		// `getRealtimeUserId` resolves to null on any failure (never rejects).
		getRealtimeUserId().then((id) => {
			if (!cancelled) {
				myUserIdRef.current = id;
				setMyUserId(id);
			}
		});
		return () => {
			cancelled = true;
		};
	}, []);

	// This connection's room member id (from the join ack), used to drop our own
	// presence echo so we never show ourselves as "typing".
	const myMemberIdRef = useRef<string | null>(null);

	// Emoji reactions for this conversation. A ghost chat is never persisted, so
	// there is nothing to react TO and no room to fan reactions out over — the
	// null conversation id disables the query the same way it skips presence.
	const {
		byMessage: reactionsByMessage,
		applyRealtimeFrame: applyReactionFrame,
		toggle: toggleReaction,
	} = useMessageReactions(ghostMode ? null : convId);

	// Remote members' latest presence (name + typing), keyed by member id. Our own
	// member is excluded. Reset when the conversation changes.
	const [remotePresence, setRemotePresence] = useState<
		Record<string, { name?: string; typing?: boolean }>
	>({});
	// Presence belongs to the room we are leaving, so wipe it when convId changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: convId is the reset trigger, not read in the body.
	useEffect(() => {
		setRemotePresence({});
		myMemberIdRef.current = null;
	}, [convId]);

	// Live-insert a message authored by ANOTHER human. Assistant turns (null
	// author) arrive through the local SSE stream, and our own message echoes back
	// under our user id (its optimistic copy is already shown under a different,
	// client-generated id) — both are skipped here. Dedupe by id guards against a
	// frame being delivered twice. Appended last = created_at order for live
	// arrival; the server timestamp is kept in metadata for later reconstruction.
	const handleRealtimeEvent = useCallback(
		(data: unknown) => {
			if (typeof data !== "object" || data === null) {
				return;
			}
			const frame = data as { type?: string; message?: unknown };
			// Reactions ride the same named-event channel as messages. Routed before
			// the message guard below, which would otherwise drop them on the floor.
			if (frame.type === "reaction") {
				applyReactionFrame(data, myUserIdRef.current);
				return;
			}
			if (frame.type !== "message" || typeof frame.message !== "object") {
				return;
			}
			const msg = frame.message as {
				id?: string;
				content?: string;
				author_user_id?: string | null;
				author_name?: string | null;
				created_at?: number;
			};
			const authorId = msg.author_user_id ?? null;
			// "Mine" matches the JWT subject Core stamps (`author_user_id`), with the
			// email as a defensive secondary key. Either match means it's our own echo
			// (its optimistic copy is already shown), so skip it.
			const isOwnMessage =
				authorId === myUserIdRef.current ||
				(myEmailRef.current !== null && authorId === myEmailRef.current);
			if (
				!msg.id ||
				typeof msg.content !== "string" ||
				!authorId ||
				isOwnMessage
			) {
				return;
			}
			const inserted = {
				id: msg.id,
				role: "user",
				parts: [{ type: "text", text: msg.content }],
				metadata: {
					author: { name: msg.author_name ?? undefined, id: authorId },
					createdAt: msg.created_at,
				},
			};
			setMessages((prev) => {
				if (prev.some((m) => m.id === msg.id)) {
					return prev;
				}
				return [...prev, inserted as unknown as (typeof prev)[number]];
			});
		},
		[setMessages, applyReactionFrame]
	);

	// Apply a presence delta from another member: upsert their name/typing, or
	// drop them on a `presence_leave`. Our own echo (same member id) is ignored.
	const handleRealtimePresence = useCallback((data: unknown) => {
		if (typeof data !== "object" || data === null) {
			return;
		}
		const frame = data as {
			type?: string;
			member_id?: string;
			name?: string;
			typing?: boolean;
		};
		const memberId = frame.member_id;
		if (!memberId || memberId === myMemberIdRef.current) {
			return;
		}
		if (frame.type === "presence_leave") {
			setRemotePresence((prev) => {
				if (!(memberId in prev)) {
					return prev;
				}
				const next = { ...prev };
				delete next[memberId];
				return next;
			});
			return;
		}
		setRemotePresence((prev) => ({
			...prev,
			[memberId]: { name: frame.name, typing: Boolean(frame.typing) },
		}));
	}, []);

	const handleRealtimeJoinAck = useCallback((ack: JoinAck) => {
		myMemberIdRef.current = ack.memberId;
	}, []);

	// A ghost (temporary) chat never opens a realtime room: its turns are never
	// persisted (so Core fans out nothing), and we also skip presence so a
	// temporary thread stays fully private. `null` room id = no join.
	const { publishPresence: publishRoomPresence } = useRealtimeRoom(
		ghostMode ? null : convId,
		"conversation",
		{
			onEvent: handleRealtimeEvent,
			onJoinAck: handleRealtimeJoinAck,
			onPresence: handleRealtimePresence,
		}
	);

	// Our presence display name (control-plane profile), read into a ref so the
	// stable typing publisher always sends the current value.
	const myPresenceNameRef = useRef("Someone");
	myPresenceNameRef.current = oidcUser?.name ?? oidcUser?.email ?? "Someone";
	const publishRoomPresenceRef = useRef(publishRoomPresence);
	publishRoomPresenceRef.current = publishRoomPresence;

	// Debounced typing presence: publish `typing:true` on activity, then
	// `typing:false` once the user pauses (or on send). No-op until the room is
	// open (publishPresence swallows pre-open calls).
	const typingTimerRef = useRef<number | null>(null);
	const stopTyping = useCallback(() => {
		if (typingTimerRef.current !== null) {
			window.clearTimeout(typingTimerRef.current);
			typingTimerRef.current = null;
		}
		publishRoomPresenceRef.current({
			typing: false,
			name: myPresenceNameRef.current,
		});
	}, []);
	const handleTypingActivity = useCallback(() => {
		publishRoomPresenceRef.current({
			typing: true,
			name: myPresenceNameRef.current,
		});
		if (typingTimerRef.current !== null) {
			window.clearTimeout(typingTimerRef.current);
		}
		typingTimerRef.current = window.setTimeout(() => {
			typingTimerRef.current = null;
			publishRoomPresenceRef.current({
				typing: false,
				name: myPresenceNameRef.current,
			});
		}, TYPING_IDLE_MS);
	}, []);

	// A short human-readable presence line: who is typing wins; otherwise who is
	// here. Empty when alone, so nothing renders in the common single-user case.
	const presenceLabel = useMemo(() => {
		const members = Object.values(remotePresence);
		const typingNames = members
			.filter((m) => m.typing)
			.map((m) => m.name?.trim() || "Someone");
		if (typingNames.length > 0) {
			const verb = typingNames.length === 1 ? "is" : "are";
			return `${typingNames.join(", ")} ${verb} typing…`;
		}
		const presentNames = members.map((m) => m.name?.trim() || "Someone");
		if (presentNames.length > 0) {
			return presentNames.length === 1
				? `${presentNames[0]} is here`
				: `${presentNames.length} others here`;
		}
		return null;
	}, [remotePresence]);

	// The conversation id of the most recently completed run. Used to query the
	// worktree diff after stream completion. Reset when a new conversation starts.
	const [diffConvId, setDiffConvId] = useState<string | null>(null);

	// ChatGPT-style next-prompt suggestions: fetched from Core once a turn
	// settles, cleared the moment the next turn starts (or the thread switches).
	const [followUps, setFollowUps] = useState<string[]>([]);
	const followUpAbort = useRef<AbortController | null>(null);

	// After a streamed reply completes, re-sync the sidebar list from Core and
	// record the conversation id so DiffReviewPane can fetch the run's diff.
	const prevStatus = useRef(status);
	useEffect(() => {
		// Keep the tab chip in sync with the live stream so the spinner/shimmer
		// appear as soon as the user sends — before Core's run_status catches up.
		if (currentTabId) {
			const busy = status === "streaming" || status === "submitted";
			updateTabBusy(currentTabId, busy);
		}
		// A new turn is in flight — drop stale chips and cancel any pending fetch.
		if (status === "streaming" || status === "submitted") {
			setFollowUps([]);
			followUpAbort.current?.abort();
			followUpAbort.current = null;
		}
		// Any transition INTO "ready", not only from "streaming": a turn that is
		// answered without ever emitting a stream chunk goes submitted → ready, and
		// gating on "streaming" meant such a turn never re-synced the sidebar — its
		// row kept the draft's title and stayed in the loose Chats bucket for the
		// rest of the session, even though Core had already stamped the folder.
		if (prevStatus.current !== "ready" && status === "ready") {
			refresh();
			// The run has finished writing files, so this is the moment the working
			// tree changed — re-read git now rather than waiting for the safety-net
			// poll. Cheap: once per turn, not once per chunk.
			invalidateGitStatus();
			if (activeConversationId) {
				invalidateWorktreeStatus(activeConversationId);
				invalidateWorktreeDiff(activeConversationId);
				setDiffConvId(activeConversationId);
			}
			// Auto read-back when enabled (Voice settings), unless a meeting is recording.
			getVoiceModeReadbackPrefs(chatTargetRef.current).then((prefs) => {
				if (!prefs.enabled) {
					return;
				}
				if (useMeetingRecordingStore.getState().active) {
					return;
				}
				const lastAssistant = messages
					.filter((m) => m.role === "assistant")
					.at(-1);
				if (!lastAssistant) {
					return;
				}
				const text = extractAssistantText(lastAssistant);
				if (text) {
					handleSpeakRef.current(text)?.catch(() => undefined);
				}
			});
			// The chat-title plugin may re-title after a completed turn. Refresh
			// once more so the sidebar picks up the new title without a reload.
			const t = setTimeout(refresh, 2500);
			prevStatus.current = status;
			// Ask Core for follow-up prompts for the turn that just finished.
			// Best-effort: an empty list simply shows no chips.
			const convId = activeConversationId ?? draftConvId.current;
			if (convId) {
				const controller = new AbortController();
				followUpAbort.current = controller;
				fetchNextPromptSuggestions(
					chatTargetRef.current,
					convId,
					controller.signal
				).then((items) => {
					if (!controller.signal.aborted) {
						setFollowUps(items);
					}
				});
			}
			return () => clearTimeout(t);
		}
		prevStatus.current = status;
	}, [
		status,
		refresh,
		activeConversationId,
		messages,
		currentTabId,
		updateTabBusy,
	]);

	// Clear busy on unmount so a closed streaming tab doesn't leave a stale spinner.
	useEffect(() => {
		return () => {
			if (currentTabId) {
				updateTabBusy(currentTabId, false);
			}
		};
	}, [currentTabId, updateTabBusy]);

	// Sidebar / TOC jump: once messages are hydrated, ask the message list to
	// scroll to the pending anchor and clear the one-shot tab flag.
	useEffect(() => {
		if (!(scrollToMessageId && currentTabId && messages.length > 0)) {
			return;
		}
		const timer = window.setTimeout(() => {
			window.dispatchEvent(
				new CustomEvent("ryu:scroll-to-message", {
					detail: { messageId: scrollToMessageId },
				})
			);
			clearScrollToMessage(currentTabId);
		}, 80);
		return () => window.clearTimeout(timer);
	}, [scrollToMessageId, currentTabId, messages.length, clearScrollToMessage]);

	// Switching threads must not carry chips across conversations.
	// `activeConversationId` is load-bearing: it is the only thing that changes on
	// a thread switch, so without it this never runs again after mount and the
	// chips leak into the next conversation.
	useEffect(() => {
		setFollowUps([]);
		followUpAbort.current?.abort();
		followUpAbort.current = null;
	}, [activeConversationId]);

	const addImages = useCallback(
		(files: File[]) => {
			const imageFiles = files.filter((f) => f.type.startsWith("image/"));
			if (imageFiles.length === 0) {
				return;
			}
			for (const file of imageFiles) {
				void stageImageUpload(chatTarget, file).then(({ dataUrl, upload }) => {
					setAttachedImages((prev) => [
						...prev,
						{
							id: upload?.id ?? `img-${Date.now()}-${Math.random()}`,
							filename: file.name,
							url: dataUrl,
							mimeType: file.type,
							size: file.size,
						},
					]);
				});
			}
		},
		[chatTarget]
	);

	const handleAttach = useCallback(() => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.multiple = true;
		input.onchange = () => {
			if (input.files) {
				addImages(Array.from(input.files));
			}
		};
		input.click();
	}, [addImages]);

	const handleRemoveImage = useCallback((id: string) => {
		setAttachedImages((prev) => prev.filter((img) => img.id !== id));
	}, []);

	const handlePaste = useCallback(
		(e: React.ClipboardEvent) => {
			const files = Array.from(e.clipboardData.files);
			addImages(files);
		},
		[addImages]
	);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setIsDragOver(true);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		if (!e.currentTarget.contains(e.relatedTarget as Node)) {
			setIsDragOver(false);
		}
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			setIsDragOver(false);
			const files = Array.from(e.dataTransfer.files);
			addImages(files);
		},
		[addImages]
	);

	// When the user clicks a run-completion OS notification, navigate to that
	// run's review pane. The event is dispatched by useRuns in the hook after
	// the Notification's onclick fires (see useRuns.ts).
	useEffect(() => {
		const handler = (e: Event) => {
			// Only the focused tab navigates, so one notification click doesn't
			// hijack every mounted chat tab.
			if (!isActiveTabRef.current) {
				return;
			}
			const { runId } = (e as CustomEvent<{ runId: string }>).detail;
			if (runId) {
				setConvId(runId);
				setActiveConversationId(runId);
				setDiffConvId(runId);
			}
		};
		window.addEventListener("ryu:run-notification-click", handler);
		return () =>
			window.removeEventListener("ryu:run-notification-click", handler);
	}, [setActiveConversationId]);

	const handleSend = useCallback(
		(message: { role: "user"; content: string }) => {
			// #403: Always surface the user's message even when blocked, so it's never
			// silently dropped. If chat is blocked, record it in blockedMessages so the
			// UI can render it with an error state.
			if (composerBlocked) {
				setBlockedMessages((prev) => [
					...prev,
					{
						id: `blocked-${Date.now()}`,
						content: message.content,
						timestamp: Date.now(),
					},
				]);
				return;
			}
			// The folder this turn is about to run in — read from the store, exactly
			// as the transport body does a moment later, so the row the sidebar shows
			// and the `cwd` Core stamps onto the conversation are the same value.
			const sendFolder = useWorkspaceStore.getState().folder ?? undefined;
			if (!convId) {
				const newId = draftConvId.current;
				// A ghost (temporary) chat is never registered in the sidebar history:
				// skip `createConversation` so it leaves no trace in the thread list.
				// The turn still streams (useChat keys off the local id) and Core
				// persists nothing because the transport sends `persist: false`.
				if (!ghostMode) {
					createConversation(newId, {
						agentId: agentId ?? undefined,
						folderPath: sendFolder,
					});
				}
				setConvId(newId);
				setActiveConversationId(newId);
			}

			// Chats started in a project belong to that project from their first
			// message, not from whenever the list next refreshes. Core stamps the
			// same folder from this turn's `cwd`; recording it locally is what keeps
			// the row from sitting in the loose "Chats" bucket in the meantime — and
			// it also catches a draft opened before the user switched folders.
			if (!ghostMode) {
				const folderTargetId = convIdRef.current ?? draftConvId.current;
				if (folderTargetId) {
					setConversationFolder(folderTargetId, sendFolder);
				}
			}

			// Name the thread after what the user just asked, right now. Core derives
			// the identical title when it persists this turn, so this only removes the
			// wait — without it the row reads "New Chat" for the whole first reply
			// (the list is only re-fetched once the turn completes). The chat-title
			// plugin replaces it with a model-written name after that reply lands.
			// Ghost chats are absent from the list, so the seed is a no-op for them.
			if (!ghostMode) {
				const titleTargetId = convIdRef.current ?? draftConvId.current;
				if (titleTargetId) {
					seedTitleFromFirstMessage(titleTargetId, message.content);
				}
			}

			// #415: Record the targeted agent for this upcoming assistant turn so we
			// can label the response bubble with the right agent name.
			const assistantIdx = messages.filter(
				(m) => m.role === "assistant"
			).length;
			const targetId = targetAgentIdRef.current;
			if (targetId) {
				const targetAgent = agents.find((a) => a.id === targetId);
				if (targetAgent) {
					agentLabelMapRef.current[String(assistantIdx)] = targetAgent.name;
				}
			} else if (participants.length === 1) {
				agentLabelMapRef.current[String(assistantIdx)] = participants[0].name;
			}

			const currentImages = attachmentRef.current.attachedImages;
			if (currentImages.length > 0) {
				sendMessage({
					text: message.content,
					files: currentImages.map((img) => ({
						type: "file" as const,
						mediaType: img.mimeType,
						filename: img.filename,
						url: img.url,
					})),
				});
				setAttachedImages([]);
			} else {
				sendMessage({ text: message.content });
			}
			// Reset after send so the next message starts fresh.
			targetAgentIdRef.current = null;
			teamIdRef.current = null;
			workflowIdRef.current = null;
			// Our turn is sent — clear any lingering "typing" presence immediately.
			stopTyping();
		},
		[
			composerBlocked,
			convId,
			agentId,
			agents,
			participants,
			messages,
			ghostMode,
			createConversation,
			setConversationFolder,
			seedTitleFromFirstMessage,
			setActiveConversationId,
			sendMessage,
			stopTyping,
		]
	);

	// Start a brand-new empty thread in THIS tab: rotate the draft id, clear the
	// active conversation and the on-screen messages. Used when the ghost toggle
	// flips so a temporary chat and a persisted chat never share a thread — a
	// persisted conversation must never receive a non-persisted turn, and a ghost
	// thread must not inherit a persisted one.
	const startFreshThread = useCallback(() => {
		draftConvId.current = `conv-${Date.now()}`;
		// An explicit "new thread" outranks the merged view's open-on-newest seed
		// for the rest of this tab's life — see the latch above.
		mergedSeeded.current = true;
		setConvId(null);
		setActiveConversationId(null);
		setMessages([]);
	}, [setActiveConversationId, setMessages]);

	const toggleGhostMode = useCallback(() => {
		startFreshThread();
		setGhostMode((on) => !on);
	}, [startFreshThread]);

	// `/btw` side question: an ephemeral question about the current conversation
	// shown in a dismissible overlay and never added to the chat history (modeled
	// on Claude Code's interactive `/btw`). The side model sees the conversation
	// context but has no tools. `null` = overlay closed.
	const [btwState, setBtwState] = useState<BtwState | null>(null);
	const btwRequestRef = useRef(0);
	// Bumped after each `/btw` resolves so the Context rail's Side-chats list
	// refetches the now-persisted aside without a full reload.
	const [sideChatsRefreshKey, setSideChatsRefreshKey] = useState(0);

	// Reopen a persisted side chat (from the Context rail or the sidebar) in the
	// btw overlay.
	const handleOpenSideChat = useCallback((entry: BtwEntry) => {
		setBtwState({
			question: entry.question,
			loading: false,
			answer: entry.answer,
			model: entry.model ?? null,
			error: null,
		});
	}, []);

	// Open a spawned subagent's transcript in the right panel. The nonce makes each
	// click a distinct request so re-selecting the same subagent re-focuses the tab;
	// opening the right panel auto-hides the (overlapping) pinned summary card.
	const [subagentReq, setSubagentReq] = useState<{
		id: string;
		label: string;
		nonce: number;
	} | null>(null);
	const subagentNonce = useRef(0);
	const handleOpenSubagent = useCallback((subagent: SubagentSummary) => {
		subagentNonce.current += 1;
		setSubagentReq({
			id: subagent.id,
			label: subagent.label,
			nonce: subagentNonce.current,
		});
		setRightPanelOpen(true);
	}, []);

	// Open a rendered/canvas artifact in the right panel — the same nonce flow as
	// the subagent, but WorkspacePanels opens ONE DEDICATED TAB per artifact (no
	// one-at-a-time limit), so clicking a second artifact stacks it alongside the
	// first rather than replacing it.
	const [artifactReq, setArtifactReq] = useState<{
		artifact: Artifact;
		nonce: number;
	} | null>(null);
	const artifactNonce = useRef(0);
	const handleOpenArtifact = useCallback((artifact: Artifact) => {
		artifactNonce.current += 1;
		setArtifactReq({ artifact, nonce: artifactNonce.current });
		setRightPanelOpen(true);
	}, []);

	// Open the context-window breakdown in the right panel (composer ring click).
	// Same nonce-per-click flow as the subagent tab, but the request carries no
	// payload: the panel reads `contextView` live so it keeps tracking the
	// conversation instead of freezing at the moment it was opened.
	const [contextReq, setContextReq] = useState<{ nonce: number } | null>(null);
	const contextNonce = useRef(0);
	const handleOpenContext = useCallback(() => {
		contextNonce.current += 1;
		setContextReq({ nonce: contextNonce.current });
		setRightPanelOpen(true);
	}, []);

	// Sidebar → side chat: the sidebar selects the thread then dispatches this
	// event. Only the tab whose conversation matches opens the overlay; if the
	// tab is still mounting (convId not yet set), stash it and flush once convId
	// catches up. Mirrors the run-notification-click decoupling below.
	const pendingSideChatRef = useRef<{
		conversationId: string;
		entry: BtwEntry;
	} | null>(null);
	useEffect(() => {
		const handler = (e: Event) => {
			const detail = (
				e as CustomEvent<{ conversationId: string; entry: BtwEntry }>
			).detail;
			if (!detail?.entry) {
				return;
			}
			if (detail.conversationId === convIdRef.current) {
				handleOpenSideChat(detail.entry);
			} else {
				// Another tab (or one still mounting) — stash it, keyed by the target
				// conversation so only the matching tab flushes it.
				pendingSideChatRef.current = detail;
			}
		};
		window.addEventListener("ryu:open-side-chat", handler);
		return () => window.removeEventListener("ryu:open-side-chat", handler);
	}, [handleOpenSideChat]);

	// Flush a pending side chat once this tab's conversation matches the one the
	// sidebar asked to open (exact id match, so other tabs never steal it).
	useEffect(() => {
		const pending = pendingSideChatRef.current;
		if (pending && pending.conversationId === convId) {
			pendingSideChatRef.current = null;
			handleOpenSideChat(pending.entry);
		}
	}, [convId, handleOpenSideChat]);

	// Stop the current stream. Aborting the SSE (`stop()`) only halts the client's
	// read — an ACP agent keeps running to completion server-side — so we ALSO ask
	// Core to cancel the live turn for this conversation. Best-effort: the endpoint
	// returns `{ cancelled: false }` when there is no live turn, and any error is
	// ignored so Stop always feels instant. The id is the same session key sent as
	// `conversation_id` on each turn.
	const handleStop = useCallback(() => {
		stop();
		// A resumed turn is read by our own fetch, not by useChat — `stop()` does
		// not touch it, so abort that reader explicitly or Stop would look dead.
		resumeAbort.current?.abort();
		setResumeStreaming(false);
		resumeSuppressedUntil.current = Date.now() + RESUME_STOP_GRACE_MS;
		const conversationId = convIdRef.current ?? draftConvId.current;
		cancelChat(chatTargetRef.current, conversationId).catch(() => {
			// No live turn (or Core unreachable) — the SSE abort above still stands.
		});
	}, [stop]);

	// Publish this tab's chat-owned shortcut handlers while it is the FOCUSED tab.
	// Every chat tab stays mounted, and the hotkey provider keeps one handler per
	// action id (last-writer-wins), so binding `chat.stop` inside ChatPage would
	// let a hidden tab own it and abort the wrong stream. Layout binds the ids
	// once and reads this slot; the owner token means a deactivating tab only
	// clears the slot when a newer tab has not already claimed it.
	const hotkeyOwner = useId();
	const publishHotkeyTargets = useChatHotkeyTargets((s) => s.publish);
	const clearHotkeyTargets = useChatHotkeyTargets((s) => s.clearIfOwner);
	useEffect(() => {
		if (!isActiveTab) {
			clearHotkeyTargets(hotkeyOwner);
			return;
		}
		publishHotkeyTargets(hotkeyOwner, {
			// `effectiveStatus`, not `status`: a resumed turn streams outside
			// useChat, and Stop must stay live for it.
			isStreaming:
				effectiveStatus === "streaming" || effectiveStatus === "submitted",
			stop: handleStop,
			startVoiceMode: voiceMode.start,
			toggleBottomPanel: () => setBottomPanelOpen((v) => !v),
			toggleRightPanel: () => setRightPanelOpen((v) => !v),
		});
		return () => clearHotkeyTargets(hotkeyOwner);
	}, [
		isActiveTab,
		hotkeyOwner,
		effectiveStatus,
		handleStop,
		voiceMode.start,
		publishHotkeyTargets,
		clearHotkeyTargets,
	]);

	// Branch ("fork into new chat"): copy this conversation's
	// history up to the chosen message into a fresh conversation and open it in a
	// new tab. Core persists the copy, so the new tab hydrates from the server.
	const handleBranch = useCallback(
		(messageId: string) => {
			// Prepended history from another thread in the merged agent view: every
			// action below writes into the LIVE conversation, so a foreign id must
			// bounce rather than branch the wrong thread.
			if (isMergedHistoryId(messageId)) {
				return;
			}
			if (!activeConversationId) {
				return;
			}
			forkConversation(activeConversationId, messageId).then((newId) => {
				if (newId) {
					openTab("/chat", { conversationId: newId, forceNew: true });
				}
			});
		},
		[activeConversationId, forkConversation, openTab]
	);

	// Load the persisted thumbs state when the active conversation changes, so a
	// reloaded transcript restores its lit thumbs. Best-effort (empty on failure).
	useEffect(() => {
		if (!activeConversationId) {
			setFeedback({});
			return;
		}
		let cancelled = false;
		getConversationFeedback(chatTargetRef.current, activeConversationId).then(
			(map) => {
				if (!cancelled) {
					setFeedback(map);
				}
			}
		);
		return () => {
			cancelled = true;
		};
	}, [activeConversationId]);

	// Thumbs 👍/👎 an assistant turn: update the lit state optimistically, then
	// persist. Core fans the vote out to the learning reward + RAG-memory sinks.
	// On a server rejection, revert to the prior state so the UI never lies.
	const handleFeedback = useCallback(
		(messageId: string, rating: "up" | "down" | null, isLatest: boolean) => {
			if (isMergedHistoryId(messageId)) {
				return;
			}
			const conv = convIdRef.current ?? activeConversationId;
			if (!conv) {
				return;
			}
			let prev: "up" | "down" | undefined;
			setFeedback((current) => {
				prev = current[messageId];
				const next = { ...current };
				if (rating) {
					next[messageId] = rating;
				} else {
					delete next[messageId];
				}
				return next;
			});
			// A live reply is still under a client id; let the server retarget the
			// newest assistant message when this is the latest turn.
			setMessageFeedback(
				chatTargetRef.current,
				conv,
				messageId,
				rating,
				isLatest
			).then((res) => {
				if (res) {
					return;
				}
				// Transport failure: roll back to the pre-click state — but only if
				// the user is still viewing the conversation that was voted on, so a
				// late rejection can't contaminate another conversation's map.
				if ((convIdRef.current ?? activeConversationId) !== conv) {
					return;
				}
				setFeedback((current) => {
					const reverted = { ...current };
					if (prev) {
						reverted[messageId] = prev;
					} else {
						delete reverted[messageId];
					}
					return reverted;
				});
			});
		},
		[activeConversationId]
	);

	// After an edit/regenerate stream settles, re-read the active path so the
	// version pager counts (and any server-side title/ordering) reflect the new
	// branch. Cheap: one GET, keyed to the conversation being edited.
	const refreshVersions = useCallback(
		async (conv: string) => {
			const history = await loadMessages(conv);
			setVersions(buildVersions(history));
		},
		[loadMessages]
	);

	// Edit a previously-sent user message (ChatGPT/Claude-style). Core creates a
	// new sibling version carrying the new text and switches the active branch to
	// it; the client truncates the thread to the edit point, then streams a fresh
	// reply (skip_user_append: the sibling is already persisted).
	const handleEditMessage = useCallback(
		async (messageId: string, newText: string) => {
			if (isMergedHistoryId(messageId)) {
				return;
			}
			const conv = convIdRef.current ?? activeConversationId;
			if (!(conv && newText.trim())) {
				return;
			}
			const newId = await editMessage(conv, messageId, newText.trim());
			if (!newId) {
				return;
			}
			// Rebuild the local thread: keep everything before the edited message,
			// then the edited user turn (under its new id). Drop the rest — the new
			// reply will stream in beneath it.
			setMessages((prev) => {
				const idx = prev.findIndex((m) => m.id === messageId);
				const head = idx >= 0 ? prev.slice(0, idx) : prev;
				return [
					...head,
					{
						id: newId,
						role: "user" as const,
						parts: [{ type: "text" as const, text: newText.trim() }],
					},
				];
			});
			skipNextUserAppendRef.current = true;
			try {
				await regenerate();
			} finally {
				await refreshVersions(conv);
			}
		},
		[
			activeConversationId,
			editMessage,
			setMessages,
			regenerate,
			refreshVersions,
		]
	);

	// Regenerate an assistant reply: Core points the active branch at the user
	// turn above it; the client drops that assistant message (and anything after)
	// and streams a fresh sibling reply.
	const handleRegenerateMessage = useCallback(
		async (messageId: string) => {
			if (isMergedHistoryId(messageId)) {
				return;
			}
			const conv = convIdRef.current ?? activeConversationId;
			if (!conv) {
				return;
			}
			const ok = await regenerateMessage(conv, messageId);
			if (!ok) {
				return;
			}
			setMessages((prev) => {
				const idx = prev.findIndex((m) => m.id === messageId);
				return idx >= 0 ? prev.slice(0, idx) : prev;
			});
			skipNextUserAppendRef.current = true;
			try {
				await regenerate();
			} finally {
				await refreshVersions(conv);
			}
		},
		[
			activeConversationId,
			regenerateMessage,
			setMessages,
			regenerate,
			refreshVersions,
		]
	);

	// Page between versions at a branch point: Core switches the active leaf to
	// the chosen sibling and descends to its leaf; the client reloads the active
	// path to re-render the selected branch (no generation).
	const handleSelectVersion = useCallback(
		async (versionId: string) => {
			if (isMergedHistoryId(versionId)) {
				return;
			}
			const conv = convIdRef.current ?? activeConversationId;
			if (!conv) {
				return;
			}
			const ok = await selectVersion(conv, versionId);
			if (!ok) {
				return;
			}
			const history = await loadMessages(conv);
			setVersions(buildVersions(history));
			const now = Date.now();
			setMessages(history.map((m) => hydrateHistoryMessage(m, now)));
		},
		[activeConversationId, selectVersion, loadMessages, setMessages]
	);

	// Reset per-thread ephemeral overlay state when switching conversations: a
	// `/btw` side question belongs to the thread it was asked in, and dismissed
	// plugin notes (e.g. double-check reviews) are per-thread too. Keyed on
	// `convId` so switching threads within the same tab clears a leftover answer
	// or dismissed note instead of carrying it across conversations.
	// biome-ignore lint/correctness/useExhaustiveDependencies: convId is the reset trigger, not read in the body.
	useEffect(() => {
		btwRequestRef.current += 1;
		setBtwState(null);
		setDismissedPluginNotes(new Set());
	}, [convId]);

	// Client-side message queue (Codex/Claude-app style). While a run streams,
	// submitted messages are stashed and auto-drained one per turn; the queue bar
	// exposes per-message "send now" and a "send all" combine. `handleSend` is the
	// real dispatch path so queued turns get the same conversation/mention/memory
	// handling as a normal send.
	const {
		queue: queuedMessages,
		enqueue: enqueueMessage,
		edit: editQueued,
		remove: removeQueued,
		clear: clearQueue,
		sendNow: sendQueuedNow,
		sendAll: sendQueuedAll,
	} = useMessageQueue({
		status: effectiveStatus,
		send: handleSend,
		// `handleStop`, not useChat's bare `stop`: the queue's force-send path
		// interrupts the run and waits for the status to return to "ready". Raw
		// `stop()` leaves a resumed reader attached, so `effectiveStatus` would
		// stay "streaming" and the forced item would never drain.
		stop: handleStop,
		blocked: composerBlocked,
	});

	// Intercept the `/btw` slash command: ask an ephemeral side question about the
	// current conversation. Returns true when the input was a `/btw` command (and
	// should not be sent as a normal message). The question/answer never enter the
	// chat history — they live only in the overlay. Available even while a turn is
	// streaming (the side question is independent of the main run).
	const maybeHandleBtwCommand = useCallback(
		(raw: string) => {
			const text = raw.trim();
			if (!(text === "/btw" || text.startsWith("/btw "))) {
				return false;
			}
			const question = text.slice("/btw".length).trim();
			if (!question) {
				// `/btw` alone is a no-op (nothing to ask) — but still swallow it so it
				// isn't sent to the agent as a literal message.
				return true;
			}
			const convId = activeConversationId;
			if (!convId) {
				setBtwState({
					question,
					loading: false,
					answer: null,
					model: null,
					error: "Ask something in this chat first, then try /btw.",
				});
				return true;
			}
			const requestId = btwRequestRef.current + 1;
			btwRequestRef.current = requestId;
			setBtwState({
				question,
				loading: true,
				answer: null,
				model: null,
				error: null,
			});
			askBtw(chatTargetRef.current, convId, question)
				.then((result) => {
					// Ignore a stale answer if the user asked another side question.
					if (btwRequestRef.current !== requestId) {
						return;
					}
					setBtwState({
						question,
						loading: false,
						answer: result.answer,
						model: result.model,
						error: null,
					});
					// The aside is now persisted server-side; refresh the rail's list.
					setSideChatsRefreshKey((k) => k + 1);
				})
				.catch((e: unknown) => {
					if (btwRequestRef.current !== requestId) {
						return;
					}
					setBtwState({
						question,
						loading: false,
						answer: null,
						model: null,
						error: e instanceof Error ? e.message : "Side question failed",
					});
				});
			return true;
		},
		[activeConversationId]
	);

	// Route composer submits: when busy, enqueue; when idle, send straight
	// through. The blocked path keeps the existing behaviour (records the message
	// in blockedMessages so it is never silently dropped).
	// Pending quote (ChatGPT-style): text the user selected in a message and chose
	// to quote. Shown above the composer and prepended to the next message as a
	// markdown blockquote on send. Cleared on send, dismiss, or thread switch.
	const [quote, setQuote] = useState<string | null>(null);
	useEffect(() => {
		setQuote(null);
	}, [activeConversationId]);

	// Mirror unsent composer text into the `@ryu/drafts` outbox so closing the tab
	// does not destroy it. A no-op unless that app is enabled, and a blank composer
	// deletes the draft — which is also how a SEND clears it, since submitting
	// empties the text.
	// Keyed on THIS tab's conversation: the draft and the auto-queue belong to the
	// thread whose composer holds the text, not to whichever tab has focus.
	const draftContext = useMemo(
		() => ({
			conversationId: convId ?? undefined,
			agentId: agentId ?? undefined,
			model: effectiveModel ?? undefined,
			folderPath: folder ?? undefined,
		}),
		[convId, agentId, effectiveModel, folder]
	);
	const autosaveDraft = useComposerDraftAutosave(draftContext);
	const maybeAutoQueue = useComposerAutoQueue(draftContext);

	const submitNow = useCallback(
		(message: { role: "user"; content: string }) => {
			// `/btw …` is a client-side command. `/goal …` is now handled
			// server-side by the io.ryu.goal plugin, so it is sent as a normal
			// message (the plugin parses it from the turn).
			if (maybeHandleBtwCommand(message.content)) {
				return;
			}
			// Bake any pending quote into the outgoing text as a leading markdown
			// blockquote, then clear it — the model sees the quoted context and the
			// sent user bubble re-renders it as a styled quote block.
			const outgoing = quote
				? {
						...message,
						content: `${formatQuotePrefix(quote)}${message.content}`,
					}
				: message;
			if (quote) {
				setQuote(null);
			}
			if (composerBlocked) {
				handleSend(outgoing);
				return;
			}
			if (effectiveStatus === "ready") {
				handleSend(outgoing);
			} else {
				enqueueMessage(outgoing.content);
			}
		},
		[
			composerBlocked,
			effectiveStatus,
			handleSend,
			enqueueMessage,
			maybeHandleBtwCommand,
			quote,
		]
	);

	// The auto-queue gate sits IN FRONT of the send, not inside it: when the node is
	// already at its concurrency ceiling and the user has asked for queueing, the
	// message becomes an armed draft and no turn starts. Only MANUAL sends pass
	// through here — the launchpad/dispatcher auto-submit path below calls
	// `submitNow` directly, because a draft the dispatcher just released for having
	// a free slot must not be re-queued by a reading taken a moment later.
	const handleComposerSubmit = useCallback(
		async (message: { role: "user"; content: string }) => {
			if (await maybeAutoQueue(message.content)) {
				return;
			}
			submitNow(message);
		},
		[maybeAutoQueue, submitNow]
	);

	// Queued messages belong to the conversation they were typed in. Switching
	// conversations resets useChat (status → "ready"), which would otherwise drain
	// stale items into the new thread — clear on every switch (mirrors the
	// blockedMessages reset below).
	// `activeConversationId` is load-bearing. `clearQueue` is
	// `useCallback(() => setQueue([]), [])` — a permanently stable identity — so
	// on its own this effect runs once at mount and NEVER on a thread switch,
	// which is exactly the stale-drain the comment above says it prevents.
	useEffect(() => {
		clearQueue();
	}, [clearQueue, activeConversationId]);

	// Clear blocked messages when a new conversation starts or services recover.
	useEffect(() => {
		if (!composerBlocked) {
			setBlockedMessages([]);
		}
	}, [composerBlocked]);

	useEffect(() => {
		if (!activeConversationId) {
			draftConvId.current = `conv-${Date.now()}`;
			setBlockedMessages([]);
		}
	}, [activeConversationId]);

	// Launchpad auto-send: when this tab was opened from the home composer with a
	// user-typed prompt (`initialSubmit`), send it as soon as the composer would
	// accept it — rather than only pre-filling the draft. The prompt + any staged
	// images (already seeded into `attachedImages`) go through the normal submit
	// path, so they stream just as if typed here. Fires once; gated on the same
	// `!composerBlocked && status === "ready"` a manual send needs, so a message
	// is never dropped into a down gateway/Core. Deep-link/Inbox seeds leave
	// `initialSubmit` unset and stay pre-fill-only (attacker-/system-controllable).
	const autoSubmitFired = useRef(false);
	useEffect(() => {
		if (autoSubmitFired.current || !initialSubmit) {
			return;
		}
		const content = initialPrompt?.trim() ?? "";
		const hasImages = (initialImages?.length ?? 0) > 0;
		if (!(content || hasImages)) {
			autoSubmitFired.current = true;
			return;
		}
		autoSubmitFired.current = true;
		// Hand the seeded message to the SAME entry point a manual send uses.
		// `submitNow` already routes every state safely — it sends when
		// ready, ENQUEUES when the turn isn't ready yet (the queue drains on ready),
		// and records into `blockedMessages` (visible error state) when the
		// gateway/Core is down. The previous `if (composerBlocked || status !==
		// "ready") return` guard dropped the message in exactly those two cases:
		// the launchpad text is never placed in the composer (`seedDraft` is
		// suppressed for `initialSubmit`), so a bailed effect made the message
		// silently vanish after the redirect from the empty-tabs shell — the user
		// landed on an empty new chat with nothing sent.
		submitNow({ role: "user", content });
	}, [initialSubmit, initialPrompt, initialImages, submitNow]);

	// Adopt the composer target from the conversation THIS TAB is on — once per
	// conversation. Keyed on the tab-local `convId`, never on the shared
	// focused-tab `activeConversationId`: every chat tab stays mounted, so the
	// shared id made every background tab re-target itself onto the focused tab's
	// agent. That is the "set opencode in one pane and Claude in another and both
	// collapse onto whichever tab is active" bug, and — because the effect also
	// listed `agentId` as a dependency — the reason picking a different agent
	// inside an existing thread snapped straight back to the thread's stored one.
	// The pick is the user's; the conversation only seeds it.
	const hydratedTargetConvRef = useRef<string | null>(null);
	useEffect(() => {
		const { hydrate, agentId: pinnedAgentId } = conversationTargetDecision({
			conversationId: convId,
			hydratedConversationId: hydratedTargetConvRef.current,
			conversationAgentId: convId ? getConversation(convId)?.agentId : null,
		});
		if (!(hydrate && pinnedAgentId)) {
			return;
		}
		hydratedTargetConvRef.current = convId;
		// An existing thread is agent-pinned (conversations carry an agentId, never
		// a team) — drop any persistent team pick so the composer target matches
		// the thread instead of silently fanning out to a team.
		setTeamId(null);
		if (pinnedAgentId !== agentIdRef.current) {
			setAgentId(pinnedAgentId);
			// Keep the model picker in sync when the conversation pins its agent
			// back (each thread owns its agent; the model follows the agent).
			setSelectedModel(getAgentModel(pinnedAgentId));
		}
	}, [convId, getConversation]);

	// Last link in the seed chain: the node-wide default agent
	// (`default-agent-selection`), which arrives asynchronously and so cannot sit
	// in the `agentId` initializer. It only ever FILLS A HOLE — a composer that
	// still has no agent at all — so a merged-view pin, a tab seed, the last-used
	// hint, a conversation's pinned agent, or the user picking one while the
	// preference was in flight all win over it.
	const nodeDefaultAgentId = useNodeDefaultAgentId();
	useEffect(() => {
		if (shouldAdoptNodeDefault(agentIdRef.current, nodeDefaultAgentId)) {
			setAgentId(nodeDefaultAgentId);
			setSelectedModel(getAgentModel(nodeDefaultAgentId));
		}
	}, [nodeDefaultAgentId]);

	// Attach the approval footer to the tool row an agent is actually BLOCKED on.
	// The gate is a real `data-ryu-permission` request from Core (the ACP
	// `session/request_permission` seam), never the part's own stream state.
	//
	// It used to key off `state === "input-available"`, which is wrong twice
	// over. Core opens every ACP tool call with a `tool-input-available` frame the
	// moment the call arrives, and the ACP wire sends that first frame with
	// `rawInput: {}` — arguments stream in afterwards and correct the part in
	// place. So the footer appeared the instant a tool started, before the agent
	// had generated the command or diff it was asking permission for. And the
	// decision never left the client: "Approve" only hid the buttons, "Skip"
	// aborted the whole turn. Nothing was ever waiting on either answer, because
	// the request that does block is resolved over `/api/chat/permission`.
	//
	// #403: Also patch in friendly error cards for failed assistant turns.
	const errorString =
		error instanceof Error ? error.message : error ? String(error) : null;

	const messagesWithApproval = useMemo(() => {
		return messages.map((m) => {
			if (m.role !== "assistant" || !m.parts) {
				return m;
			}

			// #403: If this assistant message has empty content and there's an active
			// error, inject an error card part instead of leaving it blank.
			const hasContent = m.parts.some(
				(p) => p.type === "text" && (p as { text?: string }).text?.trim()
			);
			if (!hasContent && errorString) {
				return {
					...m,
					parts: [
						{
							type: "text" as const,
							text: `__error__:${errorString}`,
						},
					],
				};
			}

			let changed = false;
			const parts = m.parts.map((part) => {
				const p = part as {
					type?: string;
					state?: string;
					toolCallId?: string;
					input?: Record<string, unknown>;
				};
				const isTool =
					p.type === "dynamic-tool" ||
					(typeof p.type === "string" && p.type.startsWith("tool-"));
				if (!(isTool && p.toolCallId)) {
					return part;
				}
				const pending = permissionsByToolCall.get(p.toolCallId);
				if (!pending) {
					return part;
				}
				changed = true;
				// The approval object is consumed by the tool renderers; it isn't
				// part of the AI SDK part schema, so reattach the original part type.
				return {
					...p,
					input: {
						...(p.input ?? {}),
						approval: {
							options: pending.options,
							onSelect: (optionId: string | null) =>
								respondToPermission(pending.requestId, optionId),
						},
					},
				} as typeof part;
			});
			return changed ? { ...m, parts } : m;
		});
	}, [messages, permissionsByToolCall, respondToPermission, errorString]);

	// #403: Synthesise blocked-message entries as visible user messages so they
	// appear in the thread even when not sent. Append them after the real messages.
	const visibleMessages = useMemo(() => {
		if (blockedMessages.length === 0) {
			return messagesWithApproval;
		}
		const blocked = blockedMessages.map((bm) => ({
			id: bm.id,
			role: "user" as const,
			parts: [{ type: "text" as const, text: bm.content }],
			_blocked: true,
		}));
		return [...messagesWithApproval, ...blocked];
	}, [messagesWithApproval, blockedMessages]);

	// #403: Custom text renderer that intercepts the __error__ sentinel and renders
	// an ErrorCard instead of raw JSON. The AgentChat component passes text parts
	// through its render pipeline — we hook in via the messages array above.
	// For the blocked-message case, we rely on AgentChat's default user bubble
	// (the message appears as normal user text, which is fine).
	//
	// #415: Also inject a per-agent label prefix into the first text part of each
	// assistant message when we have a participant label for that turn.
	const processedMessages = useMemo(() => {
		let assistantIdx = 0;
		// Resolve a message's send time: the persisted server stamp (seeded on
		// history load) if known, otherwise a client stamp captured the first time
		// this id is seen. Attached as `createdAt` so the message toolbar can render
		// it beside the action buttons for both user and assistant turns.
		const resolveCreatedAt = (id: string): Date => {
			const seen = messageSentAtRef.current;
			let stamp = seen.get(id);
			if (stamp === undefined) {
				stamp = Date.now();
				seen.set(id, stamp);
			}
			return new Date(stamp);
		};
		return visibleMessages.map((m) => {
			const createdAt = resolveCreatedAt(m.id);
			if (m.role !== "assistant" || !m.parts) {
				return { ...m, createdAt };
			}

			const myIdx = assistantIdx;
			assistantIdx += 1;

			// Codex-style: plain replies in a normal chat. Labels only appear in
			// council (multi-agent) conversations, resolved from the label map or
			// the participant list.
			const agentLabel = (() => {
				if (participants.length <= 1) {
					return null;
				}
				const mapped = agentLabelMapRef.current[String(myIdx)];
				if (mapped) {
					return mapped;
				}
				if (agentId) {
					const a = agents.find((ag) => ag.id === agentId);
					if (a) {
						return a.name;
					}
				}
				return null;
			})();

			const parts = m.parts.map((part) => {
				const p = part as { type?: string; text?: string };
				if (p.type === "text" && p.text?.startsWith("__error__:")) {
					const rawError = p.text.slice("__error__:".length);
					const { message: friendlyMsg } = friendlyError(rawError);
					return {
						...part,
						text: friendlyMsg,
					};
				}
				// Prepend the agent label line for council conversations.
				if (
					p.type === "text" &&
					agentLabel &&
					p.text !== undefined &&
					!p.text.startsWith(`**${agentLabel}**`)
				) {
					return {
						...part,
						text: `**${agentLabel}**\n\n${p.text}`,
					};
				}
				return part;
			});
			return { ...m, parts, createdAt };
		});
	}, [visibleMessages, participants, agentId, agents]);

	// What the transcript actually renders. In the merged agent view the older
	// threads sit above the live one; everything else in this page — the context
	// meter, "does this thread have messages", the transcript copy — deliberately
	// keeps reading `processedMessages`, because those messages are NOT in the
	// model's context and do not belong to the live conversation.
	const renderedMessages = useMemo(
		() =>
			merged.messages.length > 0
				? [
						...(merged.messages as unknown as typeof processedMessages),
						...processedMessages,
					]
				: processedMessages,
		[merged.messages, processedMessages]
	);

	// #415: Stable slot reference for the custom InputBar. Using useMemo with an
	// empty dep array so the component identity is stable across renders, avoiding
	// textarea focus loss on every keystroke. Agents are accessed from state
	// through a stable ref pattern inside CouncilInputBar itself.
	const agentsStableRef = useRef(agents);
	agentsStableRef.current = agents;
	const teamsStableRef = useRef(teams);
	teamsStableRef.current = teams;
	const workflowsStableRef = useRef(workflows);
	workflowsStableRef.current = workflows;
	// Aggregate the "@" mention sources into one object, held in a ref so
	// the memoized composer slot stays stable (same pattern as the agent/team
	// refs above). buildMentionGroups filters this per keystroke.
	const mentionSources = useMemo<MentionSources>(
		() => ({
			agents: agents.map((a) => ({ id: a.id, name: a.name })),
			teams: teams.map((t) => ({ id: t.id, name: t.name })),
			// Only chat-triggerable workflows (a root Input node, per Core) are
			// offered — a workflow that never reads the typed message would
			// silently ignore it.
			workflows: workflows
				.filter((w) => w.chatInput)
				.map((w) => ({ id: w.id, name: w.name, description: w.description })),
			spaces: spaces.map((s) => ({ id: s.id, name: s.name })),
			skills: installedSkills.map((s) => ({ id: s.id, name: s.name })),
			mcp: mcpServers.map((m) => ({ id: m.id, name: m.name })),
			folders: recentFolders,
			plugins: getComposerPlugins(),
		}),
		[
			agents,
			teams,
			workflows,
			spaces,
			installedSkills,
			mcpServers,
			recentFolders,
		]
	);
	const mentionSourcesRef = useRef(mentionSources);
	mentionSourcesRef.current = mentionSources;

	// Codex-style composer controls: the project (folder) picker on the left,
	// agent + model pickers on the right, all inside the input card. Held in a
	// ref (assigned every render) so the slot component identity stays stable —
	// remounting it on each change would drop textarea focus.
	// Agent · Model · Approval (+ any agent config) are merged into ONE composer
	// dropdown (ComposerSettingsMenu) whose trigger shows every active value. Each
	// control becomes a labelled section; sections with no options are dropped, so
	// the exact same data-driven visibility as the old separate pickers holds —
	// nothing is hardcoded, an agent that advertises no model/modes just shows
	// fewer rows.

	// The Model + Approval/Thinking + config sections come from the shared
	// `useComposerAcpSections` hook (see `acp` above), so ChatPage, the launchpad,
	// and the dock build them from one place and can't diverge.

	// The composer's left cluster (Agent · Model · Approval · … + capability
	// badges + usage meters) is built by the ONE shared factory, so ChatPage, the
	// launchpad, and the Ask Ryu dock render an identical bar and can never drift.
	// ChatPage feeds its richer Model chain (ACP models / config option / engine
	// catalog) via `modelSection` and its Approval + config picks via
	// `extraSections`; the factory owns the agent picker, badges, and usage meters.
	// The create/team/agent sentinel routing lives in the factory's callbacks, and
	// its composed `sections` are reused by the empty-state header so the logo
	// opens the identical Agent · Model · Thinking dropdown.
	// Once a conversation has history the composer collapses to a single row
	// ("+" · input · model · mic · send): the agent/model cluster moves to the
	// right of the input and the usage meters fold into its dropdown. The fresh
	// launchpad surface (no history) keeps the roomy left-aligned stacked layout.
	// The SAME usage the composer ring shows, derived here too so the Context
	// panel and the ring can never report different numbers (the ring derives it
	// internally from the identical inputs — see `deriveContextUsage`).
	const contextUsage = useMemo(
		() => deriveContextUsage(processedMessages, contextSize),
		[processedMessages, contextSize]
	);

	const composerCompact = processedMessages.length > 0;
	const composerCompactRef = useRef(composerCompact);
	composerCompactRef.current = composerCompact;

	// ── App-contributed composer controls (`contributes.composer_controls`) ─────
	//
	// The manifest vocabulary is `toggle` | `select` | `chip` | `action`, and each
	// reaches the composer through one of its EXISTING seams (see
	// `plugin-composer-controls.ts`): toggles are "+" menu rows, menu-placed
	// selects are settings-menu sections (fed to the shared factory as
	// `extraSections`, the same seam the ACP approval/config pickers use), and
	// chips/actions/bar-placed selects render in the composer toolbar. Nothing here
	// is per-app: an entry whose `type` this build doesn't know is dropped by the
	// partition, so a newer control degrades to "not shown" instead of breaking the
	// composer.
	const partitionedComposerControls = useMemo(
		() => partitionComposerControls(pluginContributions.composer_controls),
		[pluginContributions.composer_controls]
	);

	// The string-valued controls (a `select`'s chosen option, a `chip`'s live id),
	// keyed by each control's `flag`. Separate from `pluginFlags` because the wire
	// `plugin_flags` map is bool-only (Core's `ChatRequest`), so these values stay
	// desktop-side for now — see the note on `buildPluginFlags`.
	const [pluginControlValues, setPluginControlValues] = useState<
		Record<string, string>
	>({});
	// Stable + idempotent: re-setting the same value returns the SAME object, so a
	// chip mirroring its polled value into state can't drive a render loop.
	const setPluginControlValue = useCallback(
		(flag: string, value: string | null) => {
			setPluginControlValues((prev) => {
				if (value === null) {
					if (!(flag in prev)) {
						return prev;
					}
					const next = { ...prev };
					delete next[flag];
					return next;
				}
				return prev[flag] === value ? prev : { ...prev, [flag]: value };
			});
		},
		[]
	);

	// Menu-placed `select` controls, as settings-menu sections. The section's items
	// ARE the control's options, so the shell renders a mode picker it knows
	// nothing about. An options-less one is auto-hidden by the menu.
	const pluginComposerSelectSections = useMemo<ComposerSettingsSection[]>(
		() =>
			partitionedComposerControls.selects.map((control) => ({
				key: composerPluginSectionKey(control),
				ariaLabel: control.label,
				label: control.label,
				items: composerSelectOptions(control).map((option) => ({
					id: option.value,
					name: option.label,
					description: option.description ?? null,
				})),
				value: composerSelectValue(control, pluginControlValues),
				onChange: (id: string) => setPluginControlValue(control.flag, id),
			})),
		[
			partitionedComposerControls.selects,
			pluginControlValues,
			setPluginControlValue,
		]
	);

	// The factory's extra sections: ChatPage's own ACP approval/config pickers plus
	// whatever the enabled apps contributed.
	const composerExtraSections = useMemo(
		() => [...acp.extraSections, ...pluginComposerSelectSections],
		[acp.extraSections, pluginComposerSelectSections]
	);

	const {
		infoBar: composerInfoBar,
		leftActions: composerLeft,
		refreshRoutingAdvice,
		rightActions: composerRight,
		sections: composerSections,
		triggerSections: composerTriggerSections,
		renderBody: composerRenderBody,
	} = useComposerAgentControls({
		compact: composerCompact,
		agents,
		// An empty thread is a conversation start, which is the only point an
		// agent-swapping fallback rule may move the whole agent. Mirrors the turn
		// path's own test (`conversation_id.is_none() || messages.len() <= 1`):
		// zero RENDERED messages here is the same moment the server sees a single
		// message — the turn it is about to run. Read from THIS tab's `convId`, not
		// the shared focused-tab id, or a background tab reports the focused tab's
		// thread state and its fallback notice describes the wrong turn.
		atConversationStart: convId === null || processedMessages.length === 0,
		teams,
		agentId,
		teamId,
		onCreateAgent: () => openCreateAgent(),
		onSelectTeam: (id) => setTeamId(id),
		onSelectAgent: (id) => {
			setTeamId(null);
			setAgentId(id);
			// The pick is authoritative for THIS tab only. Remembering it seeds the
			// next brand-new chat; it must never reach back into another tab, which
			// is why nothing reads this key except a fresh composer's initializer.
			rememberLastUsedAgent(id);
			setSelectedModel(getAgentModel(id));
		},
		modelOptions,
		model: effectiveModel,
		onModelChange: handleModelChange,
		modelSection: acp.modelSection,
		extraSections: composerExtraSections,
	});

	// Bar-placed controls (chips, actions, inline selects), rendered into the
	// composer toolbar's right slot below.
	const pluginComposerBar =
		partitionedComposerControls.bar.length > 0 ? (
			<PluginComposerBarControls
				controls={partitionedComposerControls.bar}
				onActionFired={firePluginActionFlag}
				onValueChange={setPluginControlValue}
				values={pluginControlValues}
			/>
		) : null;

	// The "check my balance every time I send" half of the threshold fallback.
	// Bound to the turn LIFECYCLE rather than the submit handler: a send can land
	// through three paths here (direct, queued, blocked-retry), and the spend a
	// rule tests only exists once the turn has actually run — so re-asking as the
	// stream settles back to `ready` is both simpler and more accurate than
	// firing at keystroke time. Cache-backed in Core, so this is not a vendor
	// round-trip per message.
	const wasStreamingRef = useRef(false);
	useEffect(() => {
		const streaming = status !== "ready";
		if (wasStreamingRef.current && !streaming) {
			refreshRoutingAdvice();
		}
		wasStreamingRef.current = streaming;
	}, [status, refreshRoutingAdvice]);

	const composerControlsRef = useRef<{
		infoBar: InputBarInfoBar | undefined;
		left: ReactNode;
		right: ReactNode;
	}>({ infoBar: undefined, left: null, right: null });
	composerControlsRef.current = {
		// The threshold-fallback notice ("running this turn on X because Y is
		// low"). Rides the same ref as the other composer controls so the memoized
		// InputBar picks it up without re-rendering on every advice refetch.
		infoBar: composerInfoBar,
		// In the merged agent view the composer must say which thread a send joins
		// — the transcript above it spans several. Sits ahead of the shared
		// agent/model controls so it reads as the destination, not a setting.
		left: mergedAgentId ? (
			<>
				<MergedThreadPicker
					activeConversationId={convId}
					onNewThread={startFreshThread}
					onSelectThread={setConvId}
					threads={merged.threads}
				/>
				{composerLeft}
			</>
		) : (
			composerLeft
		),
		// Contributed bar controls sit after the shell's own right-hand controls,
		// in the one slot the memoized InputBar reads from this ref.
		right: pluginComposerBar ? (
			<>
				{composerRight}
				{pluginComposerBar}
			</>
		) : (
			composerRight
		),
	};
	// `composerSections` already carries the plugin-contributed select sections:
	// they are fed to the factory as `extraSections` above, so they render inside
	// the composer's own settings dropdown (and its universal-picker body) exactly
	// like the ACP approval/config sections do.
	//
	// This ref feeds the composer's KEYBOARD SHORTCUTS, so it must stay the full
	// list — `firstExtraConfigSection` cycles the first non-agent/model/approval
	// section, and handing it the trigger-narrowed list would repoint that shortcut
	// at a different setting than the one the popover shows.
	const composerSectionsRef =
		useRef<ComposerSettingsSection[]>(composerSections);
	composerSectionsRef.current = composerSections;

	// Workspace strip (project ▸ branch ▸ worktree) rendered above the textarea.
	// Held in a ref like composerControlsRef so the memoized InputBar slot stays
	// stable; WorkspaceBar itself reads the workspace store reactively. The
	// conversation id is the worktree store key, so the draft id is used until a
	// conversation is created.
	// Once a conversation has a thread the project ▸ branch ▸ worktree strip moves
	// out of the composer and into the floating Pinned summary card (top-right), so
	// the composer footer stays clean during a chat. On a fresh draft (no thread)
	// the strip stays in the composer — the natural place to pick a project first.
	const workspaceBarRef = useRef<ReactNode>(null);
	workspaceBarRef.current =
		processedMessages.length > 0 ? null : (
			<WorkspaceBar
				conversationId={activeConversationId ?? draftConvId.current}
				target={chatTarget}
			/>
		);

	// Live queue state for the InputBar's queue bar. Held in a ref (assigned every
	// render) so the slot component identity stays stable — see the note on
	// composerControlsRef above.
	const queueBarRef = useRef<QueueBarProps>({
		items: [],
		onEdit: editQueued,
		onSendNow: sendQueuedNow,
		onRemove: removeQueued,
		onSendAll: sendQueuedAll,
		onClear: clearQueue,
	});
	queueBarRef.current = {
		items: queuedMessages,
		onEdit: editQueued,
		onSendNow: sendQueuedNow,
		onRemove: removeQueued,
		onSendAll: sendQueuedAll,
		onClear: clearQueue,
	};

	// Goal affordances for the composer, held in refs so the memoized InputBar slot
	// stays stable (see composerControlsRef/queueBarRef above). The "+" dropdown
	// chip uses `active` (goal set and not yet achieved); the bar shows whenever a
	// goal exists (including the achieved state) or a draft is open.
	// Generic plugin-contributed composer toggles, mapped to the "+" dropdown rows.
	// Every `toggle` composer control (double-check included — it is now a plain
	// plugin contribution, no special-case) renders through this one generic loop
	// and merges into `plugin_flags` uniformly. Held in a ref (read by the memoized
	// InputBar slot) so a toggle re-renders the composer without rebuilding the slot.
	const pluginComposerControls = useMemo<PluginComposerControlRow[]>(
		() =>
			partitionedComposerControls.toggles.map((c) => ({
				id: c.id,
				flag: c.flag,
				label: c.label,
				description: c.description,
				enabled: Boolean(pluginFlags[c.flag]),
				onToggle: (flag: string, next: boolean) =>
					setPluginFlags((m) => ({ ...m, [flag]: next })),
			})),
		[partitionedComposerControls.toggles, pluginFlags]
	);
	const pluginComposerControlsRef = useRef<PluginComposerControlRow[]>([]);
	pluginComposerControlsRef.current = pluginComposerControls;

	// Ghost (temporary) chat toggle, now a row in the composer "+" dropdown rather
	// than a standalone toolbar button. Held in a ref (assigned every render) so
	// the memoized InputBar slot stays stable. Only offered on the new-chat surface
	// (no rendered messages) — an existing conversation can't retroactively become
	// temporary — but it stays available during an active ghost chat so the user
	// can see and exit the temporary state. `undefined` hides the row entirely.
	const ghostControlsRef = useRef<GhostControls | undefined>(undefined);
	ghostControlsRef.current =
		processedMessages.length === 0 || ghostMode
			? { active: ghostMode, onToggle: toggleGhostMode }
			: undefined;

	const councilInputBar = useMemo(() => {
		return function BoundCouncilInputBar(props: InputBarProps) {
			return (
				<CouncilInputBar
					{...props}
					allAgents={agentsStableRef.current}
					allTeams={teamsStableRef.current}
					allWorkflows={workflowsStableRef.current}
					availableCommands={commandsRef.current}
					// Single-row compact composer once the chat has history (read from a
					// ref so the memoized slot flips without rebuilding — same pattern as
					// workspaceBar). Pairs with the right-aligned controls above.
					compact={composerCompactRef.current}
					composerSections={composerSectionsRef.current}
					enableQueue
					// Dashed violet composer treatment while a ghost (temporary) chat is
					// active. `ghostMode` is a dep of this memo, so the closure value is
					// always current (no ref needed).
					ghost={ghostMode}
					// The "+" dropdown's Temporary-chat toggle row (read fresh from the
					// ref so gating on rendered messages stays current).
					ghostControls={ghostControlsRef.current}
					infoBar={composerControlsRef.current.infoBar}
					leftActions={composerControlsRef.current.left}
					mentionSources={mentionSourcesRef.current}
					onGenerateImage={handleGenerateImage}
					onGenerateVideo={handleGenerateVideo}
					onRespondPermission={permissionRef.current.onRespond}
					onTargetAgentChange={(id) => {
						targetAgentIdRef.current = id;
					}}
					onTeamChange={(id) => {
						teamIdRef.current = id;
					}}
					onTyping={handleTypingActivity}
					onWorkflowChange={(id) => {
						workflowIdRef.current = id;
					}}
					permission={permissionRef.current.permission}
					pluginControls={pluginComposerControlsRef.current}
					queueBar={queueBarRef.current}
					rightActions={composerControlsRef.current.right}
					voice={{
						transcribe: voiceTranscribe,
						disabled: composerBlockedRef.current,
					}}
					voiceMode={{ onStart: voiceMode.start }}
					workspaceBar={workspaceBarRef.current}
				/>
			);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		voiceTranscribe,
		handleGenerateVideo,
		handleGenerateImage,
		voiceMode.start,
		// Rebuild the composer slot when ghost mode flips so the violet ring
		// reflects it immediately (a toggle already starts a fresh thread, so the
		// brief remount costs nothing — the textarea is cleared and unfocused).
		ghostMode,
		handleTypingActivity,
	]);

	const hasThread =
		activeConversationId !== null || processedMessages.length > 0;

	// "History page" = the conversation has actual messages on screen. The
	// new-chat surface (centered empty state) can still carry a focused-tab
	// `activeConversationId`, so gate the workspace-bar relocation and the pinned
	// summary strictly on rendered messages — never on the new-chat page.
	const hasMessages = processedMessages.length > 0;

	// The Pinned summary sidebar shows only on a history page. It stacks with
	// the right panel (both docked columns can be open at once) — visibility is
	// just the user's titlebar toggle (`pinnedSummaryOpen`).
	const pinnedSummaryVisible = hasMessages && pinnedSummaryOpen;

	// The Cowork context (Progress / Artifacts / Changes / Sources / Side chats),
	// shared by the right panel's Context tab and the floating Pinned summary card.
	const coworkData = {
		messages,
		runId: convId,
		target: chatTarget,
		chatStatus: status,
		onOpenArtifact: handleOpenArtifact,
		onOpenSideChat: handleOpenSideChat,
		onOpenSubagent: handleOpenSubagent,
		sideChatsRefreshKey,
	};

	// The desktop half of the artifact host: `@ryu/blocks` renders an inline
	// artifact card through this context (openInPanel / openInTab / fetchContent /
	// submitFollowUp), and the Renderer is our InlineArtifact card. `openInTab`
	// resolves a created artifact's blob BEFORE the tab opens so the window-tab
	// page (which has no host) renders content rather than an empty view.
	const artifactHostValue = useMemo<ArtifactHostValue>(() => {
		const openArtifactTab = (payload: HostArtifact, id: string) => {
			const artifact = artifactFromPayload(payload, id, "tool");
			const openTabNow = (resolved: Artifact) => {
				useArtifactStore.getState().put(resolved);
				openTab(`/artifact/${id}`, {
					title: resolved.title,
					icon: { kind: "icon", id: "hugeicons:browser" },
				});
			};
			if (!artifact.content && artifact.url) {
				Promise.resolve(fetchArtifactContent(chatTarget, artifact.url))
					.then((content) =>
						openTabNow(content ? { ...artifact, content } : artifact)
					)
					.catch(() => openTabNow(artifact));
				return;
			}
			openTabNow(artifact);
		};
		return {
			openInPanel: (payload, id) =>
				handleOpenArtifact(artifactFromPayload(payload, id, "tool")),
			openInTab: openArtifactTab,
			fetchContent: (payload) =>
				payload.url
					? fetchArtifactContent(chatTarget, payload.url)
					: Promise.resolve(null),
			submitFollowUp: (text) => {
				Promise.resolve(
					handleComposerSubmit({ role: "user", content: text })
				).catch(() => undefined);
			},
			Renderer: InlineArtifact,
		};
	}, [chatTarget, handleOpenArtifact, openTab, handleComposerSubmit]);

	// A ghost thread has no store-backed title (it's never persisted), so label it
	// "Temporary chat" to reinforce that this conversation won't be saved.
	const persistedTitle = activeConversationId
		? getConversation(activeConversationId)?.title
		: undefined;
	const conversationTitle = ghostMode
		? "Temporary chat"
		: (persistedTitle ?? "New chat");

	// Push the conversation title and contextual actions into the shared titlebar.
	// Actions are memoized so the effect only re-fires when the relevant state changes.
	const titlebarActions = useMemo(() => {
		// The agent info icon, branch, council participants, and sessions moved
		// into the composer toolbar (see composerControlsRef.left). Only the tool
		// count, copy transcript, and the panel toggles remain in the titlebar.
		const threadActions =
			hasThread && agentTools.length > 0 ? (
				<Tooltip>
					<TooltipTrigger
						render={
							<span className="hidden truncate px-2 text-muted-foreground text-xs lg:inline">
								{agentTools.length} tool{agentTools.length === 1 ? "" : "s"}
							</span>
						}
					/>
					<TooltipContent>{agentTools.join(", ")}</TooltipContent>
				</Tooltip>
			) : null;

		const copyTranscriptAction = hasMessages ? (
			<Tooltip>
				<TooltipTrigger
					render={
						<button
							aria-label="Copy transcript"
							className="flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							onClick={() => {
								void copyChatTranscript(processedMessages, {
									defaultUserName: oidcUser?.name || oidcUser?.email,
								});
							}}
							type="button"
						>
							<HugeiconsIcon
								className="size-4"
								icon={ClipboardIcon}
								stroke="currentColor"
							/>
						</button>
					}
				/>
				<TooltipContent>Copy transcript</TooltipContent>
			</Tooltip>
		) : null;

		return (
			<>
				{threadActions}
				{copyTranscriptAction}
				<PanelToggleButtons
					bottomOpen={bottomPanelOpen}
					folder={folder}
					onBottomToggle={() => setBottomPanelOpen((v) => !v)}
					onPinnedSummaryToggle={
						hasMessages ? () => setPinnedSummaryOpen((v) => !v) : undefined
					}
					onRightToggle={() => setRightPanelOpen((v) => !v)}
					pinnedSummaryOpen={pinnedSummaryOpen}
					rightOpen={rightPanelOpen}
				/>
			</>
		);
	}, [
		hasThread,
		hasMessages,
		agentTools,
		processedMessages,
		bottomPanelOpen,
		rightPanelOpen,
		folder,
		pinnedSummaryOpen,
	]);

	useTitleBar(hasThread ? conversationTitle : null, titlebarActions);

	return (
		<ArtifactHostContext.Provider value={artifactHostValue}>
			<WorkspacePanels
				artifactRequest={artifactReq}
				bottomOpen={bottomPanelOpen}
				contextRequest={contextReq}
				contextView={{
					conversationId: activeConversationId ?? draftConvId.current,
					target: chatTarget,
					usage: contextUsage,
				}}
				cowork={coworkData}
				folder={folder}
				onBottomOpenChange={setBottomPanelOpen}
				onRightOpenChange={setRightPanelOpen}
				renderPinnedSummary={
					pinnedSummaryVisible
						? ({ floating }) => (
								<PinnedSummaryPanel
									conversationId={activeConversationId ?? draftConvId.current}
									cowork={coworkData}
									folder={folder}
									onDismiss={floating ? dismissPinnedSummary : undefined}
									target={chatTarget}
								/>
							)
						: null
				}
				rightOpen={rightPanelOpen}
				subagentRequest={subagentReq}
			>
				<div className="flex h-full flex-col overflow-hidden">
					{voiceMode.active && <VoiceModeOverlay voice={voiceMode} />}
					{/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: custom drag/resize interaction */}
					<div
						className="relative flex-1 overflow-hidden"
						onDragLeave={handleDragLeave}
						onDragOver={handleDragOver}
						onDrop={handleDrop}
					>
						<WidgetHostContext.Provider value={widgetHostValue}>
							<AgentChat
								assistantAvatar={assistantIdentity.avatar}
								assistantName={assistantIdentity.name}
								assistantPlanningAvatars={assistantPlanningAvatars}
								attachments={{
									images: attachedImages,
									onAttach: handleAttach,
									onRemoveImage: handleRemoveImage,
									onPaste: handlePaste,
									isDragOver,
								}}
								// Pad the message list down by the titlebar height so the
								// conversation rests below the frosted bar yet scrolls under it.
								classNames={{ messageList: "pt-12" }}
								contextSize={contextSize}
								// Opening this thread jumps the transcript to the newest
								// message; the id is what makes that fire once per
								// conversation rather than on every history rewrite.
								conversationKey={convId ?? undefined}
								currentUser={{
									avatar: oidcUser?.picture,
									id: myUserId ?? undefined,
									name: oidcUser?.name || oidcUser?.email,
								}}
								// Launchpad: every openable app as a grid of icon tiles under
								// the composer, on the start page only. Renders nothing when no
								// enabled app contributes a UI surface.
								emptyStateFooter={<AppLaunchpad />}
								emptyStateHeader={
									<EmptyStateHeader
										logo={emptyStateLogo}
										// The full Agent · Model · Thinking dropdown from the shared
										// composer factory — the logo opens the identical menu the
										// composer's settings trigger does, not just an agent list.
										renderBody={composerRenderBody}
										// The narrowed list: this logo IS a settings trigger, so it
										// summarises exactly what the composer's own trigger does.
										sections={composerTriggerSections}
										// Ghost (temporary) chat: the empty-state greeting whispers
										// "secretly" so it's obvious this thread won't be saved.
										title={
											ghostMode ? "What are we secretly doing?" : undefined
										}
									/>
								}
								emptyStatePosition="center"
								error={error ?? undefined}
								feedback={feedback}
								followUps={{
									items: followUps.map((text, i) => ({
										id: `followup-${i}`,
										label: text,
										value: text,
									})),
									// One click runs the suggested next prompt straight away.
									onSelect: (item) => {
										setFollowUps([]);
										handleComposerSubmit({
											role: "user",
											content: item.value ?? item.label,
										});
									},
								}}
								// A restored tab must say "loading this conversation", never
								// paint the new-chat greeting — that is what reads as "all my
								// chats are gone" at boot. Both flags are false for a genuinely
								// new chat (no conversation id), so the greeting is untouched
								// there.
								historyError={
									historyFailed
										? {
												title: "Couldn't load this conversation",
												description:
													"This node didn't answer. Your messages are still on it — nothing has been lost.",
												onRetry: retryHistoryLoad,
											}
										: undefined
								}
								historyLoading={historyLoading}
								key={`${activeNode.url}-${chatId}`}
								messageActions={contributedMessageActions}
								messages={renderedMessages}
								onBranch={activeConversationId ? handleBranch : undefined}
								onClearQuote={() => setQuote(null)}
								onContributedMessageAction={
									activeConversationId
										? handleContributedMessageAction
										: undefined
								}
								onDraftChange={autosaveDraft}
								onEditMessage={
									activeConversationId ? handleEditMessage : undefined
								}
								onFeedback={activeConversationId ? handleFeedback : undefined}
								onOpenContext={handleOpenContext}
								onQuote={setQuote}
								onRegenerateMessage={
									activeConversationId ? handleRegenerateMessage : undefined
								}
								// Unconditional: a generation part is client-only, so retrying
								// one needs no persisted conversation (unlike regenerate above).
								onRetryGeneration={handleRetryGeneration}
								onSelectVersion={
									activeConversationId ? handleSelectVersion : undefined
								}
								onSend={handleComposerSubmit}
								onSpeak={handleSpeak}
								onStop={handleStop}
								// Reactions need a persisted conversation to attach to and a
								// realtime room to fan out over; a ghost chat has neither.
								onToggleReaction={
									activeConversationId && !ghostMode
										? toggleReaction
										: undefined
								}
								quote={quote}
								reactionsByMessage={reactionsByMessage}
								seedDraft={initialSubmit ? undefined : initialPrompt}
								showCopyToolbar
								slots={{ InputBar: councilInputBar }}
								status={effectiveStatus}
								toolRenderers={EMPTY_TOOL_RENDERERS}
								versions={versions}
							/>
						</WidgetHostContext.Provider>
						{/* The Pinned summary sidebar (project ▸ branch ▸ worktree + git
					    changes + commit & push) is rendered by WorkspacePanels via
					    renderPinnedSummary — docked column stacked with the right panel,
					    auto-demoted to a floating overlay when the chat gets narrow. */}
						{/* Multi-user presence: who else is in this conversation, and whether
					    they are typing. Hidden when alone (single-user flow unchanged). */}
						{presenceLabel && (
							<div
								aria-live="polite"
								className="absolute top-14 left-1/2 z-10 -translate-x-1/2 rounded-full bg-popover/90 px-3 py-1 text-muted-foreground text-xs shadow-sm backdrop-blur"
							>
								{presenceLabel}
							</div>
						)}
					</div>
					{diffConvId && (
						<div className="shrink-0 px-4 pb-3">
							<DiffReviewPane runId={diffConvId} target={chatTarget} />
						</div>
					)}
				</div>
				<BtwOverlay onClose={() => setBtwState(null)} state={btwState} />
				{activePluginNote && (
					<div className="fixed bottom-28 left-1/2 z-50 w-[min(40rem,90vw)] -translate-x-1/2 rounded-lg bg-popover p-3 text-popover-foreground text-sm shadow-lg">
						<div className="mb-1 flex items-center justify-between">
							<span className="font-medium text-muted-foreground text-xs">
								Double-check
							</span>
							<button
								className="text-muted-foreground text-xs hover:text-foreground"
								onClick={() =>
									setDismissedPluginNotes((prev) => {
										const next = new Set(prev);
										next.add(activePluginNote.id);
										return next;
									})
								}
								type="button"
							>
								Dismiss
							</button>
						</div>
						<p className="whitespace-pre-wrap">{activePluginNote.text}</p>
					</div>
				)}
			</WorkspacePanels>
		</ArtifactHostContext.Provider>
	);
}
