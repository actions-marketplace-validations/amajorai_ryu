// The composer's TARGET (which agent a turn is about to run on) and the rules
// that decide it. Pure, so the precedence can be tested without mounting the
// 4k-line ChatPage.
//
// Why this exists as its own module: every chat tab stays mounted at once
// (`Layout.tsx`), so "the composer's agent" is not one value — it is one value
// PER TAB, and the thing that owns it durably is the conversation, not the
// window. ChatPage used to hydrate its agent from the SHARED, focused-tab
// `activeConversationId`, which meant every background tab silently adopted the
// focused tab's agent: set opencode in one pane and Claude in another and both
// collapsed onto whichever tab you were looking at. The rules below take the
// conversation the tab is actually on, and nothing else.
//
// Three scopes, deliberately distinct:
//
//   - CONVERSATION (durable, server-side). `conversations.agent_id` in Core is
//     the truth for an existing thread — the turn body's `agent_id` writes it
//     NEW-wins on every send, so a thread reopened after a restart comes back
//     on the agent it last ran. {@link conversationTargetDecision} is how a tab
//     adopts it, exactly once per conversation.
//   - TAB (live, in-memory). The user's pick before/between turns. It is React
//     state inside one ChatPage instance and is never shared with another tab.
//   - NODE (the fallback chain for a chat that has no conversation yet), see
//     {@link seedComposerAgentId}.

/**
 * localStorage key holding the agent the user picked LAST in any composer.
 *
 * It is a "resume where I left off" hint for a BRAND NEW chat, not a default in
 * the settings sense — the node-wide default is Core's `default-agent-selection`
 * preference (`DEFAULT_AGENT_SELECTION_PREF_KEY`), which this key shadows once
 * the user has picked anything at all. Writing it must never retarget a tab that
 * is already on a conversation.
 */
export const LAST_USED_AGENT_KEY = "ryu_default_agent";

/** The last agent picked in any composer, or null on a fresh install. */
export function readLastUsedAgentId(): string | null {
	try {
		return localStorage.getItem(LAST_USED_AGENT_KEY);
	} catch {
		return null;
	}
}

/** Remember an explicit agent pick as the seed for the next BRAND NEW chat. */
export function rememberLastUsedAgent(agentId: string): void {
	try {
		localStorage.setItem(LAST_USED_AGENT_KEY, agentId);
	} catch {
		/* storage denied — the seed is a convenience, never load-bearing */
	}
}

export interface ComposerAgentSeed {
	/** {@link readLastUsedAgentId} — the user's own most recent pick. */
	lastUsedAgentId?: string | null;
	/** The agent a `/chat/agent/:id` merged view is ABOUT. Pins the target. */
	pinnedAgentId?: string | null;
	/** The agent carried on the tab seed (launchpad send, `ryu://chat/new`). */
	seededAgentId?: string | null;
}

/**
 * What a chat with no conversation yet opens on. Synchronous sources only, in
 * precedence order: the merged view's pin, then the tab seed, then the last
 * agent the user picked. Returns null when the user has never picked one — the
 * caller then adopts the node-wide default (see {@link shouldAdoptNodeDefault}),
 * which is async and therefore cannot participate in a `useState` initializer.
 */
export function seedComposerAgentId({
	pinnedAgentId,
	seededAgentId,
	lastUsedAgentId,
}: ComposerAgentSeed): string | null {
	return pinnedAgentId ?? seededAgentId ?? lastUsedAgentId ?? null;
}

/**
 * Whether the node-wide default (`default-agent-selection`) still applies by the
 * time it has been fetched.
 *
 * It is the LAST link in the chain, so it may only fill a hole: a tab whose
 * composer has no agent at all. Anything that resolved first — a merged-view
 * pin, a tab seed, the last-used hint, a conversation's own pinned agent, or the
 * user picking one while the request was in flight — leaves `currentAgentId`
 * non-null and wins. That is what keeps a late-arriving preference from
 * retargeting a tab the user has already aimed.
 */
export function shouldAdoptNodeDefault(
	currentAgentId: string | null,
	nodeDefaultAgentId: string | null | undefined
): nodeDefaultAgentId is string {
	return currentAgentId === null && Boolean(nodeDefaultAgentId);
}

export interface ConversationTargetInput {
	/** `conversations.agent_id` as Core reported it for {@link conversationId}. */
	conversationAgentId: string | null | undefined;
	/** The conversation THIS tab renders. Never the shared focused-tab id. */
	conversationId: string | null;
	/** The conversation this tab has already hydrated its target from. */
	hydratedConversationId: string | null;
}

export interface ConversationTargetDecision {
	/** The agent to adopt when {@link hydrate} is true. */
	agentId: string | null;
	/**
	 * Adopt the conversation's pinned agent now, and latch it as hydrated. False
	 * while the conversation list is still loading (nothing to adopt yet) and
	 * false forever after for the same conversation.
	 */
	hydrate: boolean;
}

/**
 * Whether this tab should take its composer target from the conversation it is
 * on — ONCE per conversation.
 *
 * The once-per-conversation latch is the whole point. The previous rule re-ran
 * on every change of the composer's own agent, so picking a different agent
 * inside an existing thread was immediately reverted to the thread's stored one:
 * the user's click appeared to do nothing, and any agent that DID stick was
 * really the focused tab's leaking across. A pick inside a thread is now
 * authoritative for that tab until the thread changes; Core adopts it NEW-wins
 * on the next turn (`conversations.agent_id`), so it survives a restart too.
 */
export function conversationTargetDecision({
	conversationId,
	hydratedConversationId,
	conversationAgentId,
}: ConversationTargetInput): ConversationTargetDecision {
	if (
		!(conversationId && conversationAgentId) ||
		hydratedConversationId === conversationId
	) {
		return { hydrate: false, agentId: null };
	}
	return { hydrate: true, agentId: conversationAgentId };
}
