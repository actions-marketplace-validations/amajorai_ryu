// apps/desktop/src/lib/api/channels.ts
//
// Typed client for channel-bot configuration (Telegram/Slack/WhatsApp/Discord,
// and iMessage via a BlueBubbles Server on the operator's Mac).
//
// Unlike every other desktop client module, this targets the identity/control
// plane server (:3000, BACKEND_URL) rather than a Core node — channel configs are
// a "what is allowed/configured" concern and live in the control plane
// (packages/api `/api/channels`, MongoDB), authenticated with the Better-Auth
// session bearer token. The gateway reads enabled configs at startup and runs the
// platform listeners (apps/gateway/src/channels/*), forwarding inbound messages
// to Core's POST /api/channels/run.
//
// Secrets are write-only: list/get responses mask them as "***". On edit we send
// only the secret fields the user actually changed (the server merges them).

import { BACKEND_URL, TOKEN_KEY } from "@/lib/auth-client.ts";

export const CHANNEL_TYPES = [
	"telegram",
	"slack",
	"whatsapp",
	"whatsapp_personal",
	"discord",
	"bluebubbles",
] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

/** When the bot replies inside a group chat (DMs always reply). */
export const GROUP_REPLY_MODES = ["mentions", "all"] as const;
export type GroupReplyMode = (typeof GROUP_REPLY_MODES)[number];

/** Who may DM the bot, and how a stranger enrols. See DM_POLICIES in
 *  packages/db/src/models/channel.model.ts — that is the enforcing copy. */
export const DM_POLICIES = [
	"pairing",
	"allowlist",
	"open",
	"disabled",
] as const;
export type DmPolicy = (typeof DM_POLICIES)[number];

/** Whether the bot answers in groups at all. */
export const GROUP_POLICIES = ["allowlist", "open", "disabled"] as const;
export type GroupPolicy = (typeof GROUP_POLICIES)[number];

/** When the bot answers with synthesized speech as well as text. */
export const VOICE_REPLY_MODES = ["never", "mirror", "always"] as const;
export type VoiceReplyMode = (typeof VOICE_REPLY_MODES)[number];

export type ChannelCredentialSource = "ryu_managed" | "customer";
export type ManagedChannelProvisioningState = "ready" | "awaiting_provider";

export interface ReactionLearningSettings {
	allowGroup: boolean;
	enabled: boolean;
	negativeEmoji: string[];
	positiveEmoji: string[];
}

/**
 * Per-bot behaviour settings: who may talk to it, how it behaves while working,
 * and what its profile says. Flat across every platform — a channel that cannot
 * honour a setting ignores it (WhatsApp has no command menu, iMessage has no
 * threads), which is why the form gates which controls it renders rather than
 * the wire shape varying by type.
 */
export interface ChannelBehavior {
	dmAllowlist: string[];
	dmPolicy: DmPolicy;
	groupAllowlist: string[];
	groupPolicy: GroupPolicy;
	groupUserAllowlist: string[];
	lifecycleReactions: boolean;
	/** Send Ryu's first welcome without waiting for a user message. */
	proactiveOpening: boolean;
	/** Direct-chat id that may receive the first welcome. */
	proactiveTarget: string | null;
	profileDescription: string | null;
	profileName: string | null;
	profileShortBio: string | null;
	publishCommands: boolean;
	/** Optional provider emoji → Learning feedback mapping. */
	reactionLearning?: ReactionLearningSettings;
	richText: boolean;
	sendReadReceipts: boolean;
	streaming: boolean;
	threadReplies: boolean;
	typingIndicator: boolean;
	voiceReply: VoiceReplyMode;
}

// The per-channel required-credential map and its field labels deliberately do
// NOT live here. This module once carried its own copy, which silently drifted
// from the gateway's real contract (it still demanded only 2 of WhatsApp's 4
// keys) while having zero consumers. The form's copy — the one that renders —
// is REQUIRED_SECRETS/SECRET_LABELS/CHANNEL_SETUP in
// packages/blocks/src/desktop/channels.tsx, and the enforcing copy is
// REQUIRED_SECRETS in packages/api/src/routers/channels.ts (the server guard,
// mirroring apps/gateway/src/channels/*.rs). Don't add a third.

export const CHANNEL_LABELS: Record<ChannelType, string> = {
	telegram: "Telegram",
	slack: "Slack",
	whatsapp: "WhatsApp Business (Cloud API)",
	whatsapp_personal: "WhatsApp Personal",
	discord: "Discord",
	bluebubbles: "iMessage (BlueBubbles)",
};

/** A channel config as returned by the server (secrets masked to "***"). */
export interface ChannelConfig extends ChannelBehavior {
	agentId: string | null;
	channelType: ChannelType;
	createdAt: string;
	createdBy: string;
	credentialSource: ChannelCredentialSource;
	enabled: boolean;
	/** When the bot replies in a group chat (mentions-only vs every message). */
	groupReplyMode: GroupReplyMode;
	id: string;
	managedBotId: string | null;
	managedBotUsername: string | null;
	managedProvisioningState: ManagedChannelProvisioningState | null;
	model: string | null;
	name: string;
	organizationId: string | null;
	platformOptions?: Record<string, unknown>;
	/** Node binding for Ryu-created credentials; null means org-global. */
	provisionedServerId: string | null;
	secrets: Record<string, string>;
	systemPrompt: string | null;
	/** Team this bot routes to instead of a single agent. Mutually exclusive
	 * with agentId — when set, the team's lead orchestrates its members. */
	teamId: string | null;
	updatedAt: string;
}

export interface ChannelInput extends Partial<ChannelBehavior> {
	agentId?: string | null;
	channelType: ChannelType;
	enabled?: boolean;
	groupReplyMode?: GroupReplyMode;
	model?: string | null;
	name: string;
	platformOptions?: Record<string, unknown>;
	/** Only the secret keys being set/changed; the server merges on update. */
	secrets?: Record<string, string>;
	systemPrompt?: string | null;
	teamId?: string | null;
}

/** True when the user has a session token; channel CRUD requires sign-in. */
export function hasChannelAuth(): boolean {
	try {
		return Boolean(localStorage.getItem(TOKEN_KEY));
	} catch {
		return false;
	}
}

function authHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	try {
		const token = localStorage.getItem(TOKEN_KEY);
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}
	} catch {
		// No storage — request will 401 and the UI prompts to sign in.
	}
	return headers;
}

const BASE = `${BACKEND_URL.replace(/\/$/, "")}/api/channels`;

async function parseError(resp: Response): Promise<Error> {
	if (resp.status === 401) {
		return new Error("Sign in to manage channels.");
	}
	try {
		const body = (await resp.json()) as { message?: string; error?: string };
		const msg = body.message ?? body.error;
		if (msg) {
			return new Error(msg);
		}
	} catch {
		// Non-JSON body.
	}
	return new Error(`Request failed: ${resp.status}`);
}

export async function listChannels(): Promise<ChannelConfig[]> {
	const resp = await fetch(BASE, { headers: authHeaders() });
	if (!resp.ok) {
		throw await parseError(resp);
	}
	const body = (await resp.json()) as { channels?: ChannelConfig[] };
	return body.channels ?? [];
}

export async function createChannel(
	input: ChannelInput
): Promise<ChannelConfig> {
	const resp = await fetch(BASE, {
		method: "POST",
		headers: authHeaders(),
		body: JSON.stringify(input),
	});
	if (!resp.ok) {
		throw await parseError(resp);
	}
	return (await resp.json()) as ChannelConfig;
}

export async function updateChannel(
	id: string,
	input: Partial<ChannelInput>
): Promise<ChannelConfig> {
	const resp = await fetch(`${BASE}/${id}`, {
		method: "PATCH",
		headers: authHeaders(),
		body: JSON.stringify(input),
	});
	if (!resp.ok) {
		throw await parseError(resp);
	}
	return (await resp.json()) as ChannelConfig;
}

export async function deleteChannel(id: string): Promise<void> {
	const resp = await fetch(`${BASE}/${id}`, {
		method: "DELETE",
		headers: authHeaders(),
	});
	if (!resp.ok) {
		throw await parseError(resp);
	}
}
