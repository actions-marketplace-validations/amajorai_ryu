// Channel-bot management as a standalone tab page (ported out of the Gateway
// settings dialog). Configs live in the control-plane server (lib/api/channels.ts
// → :3000) and are account-global — not scoped to the active Core node. A bot
// routes to a single agent OR a team. Secrets are write-only: existing tokens
// are never shown; leaving a credential field blank on edit keeps the stored
// value.

import {
	type ChannelConfigView,
	type ChannelSavePayload,
	ChannelsView,
} from "@ryu/blocks/desktop/channels";
import { useState } from "react";
import { useAgents } from "@/src/hooks/useAgents.ts";
import { useChannels } from "@/src/hooks/useChannels.ts";
import { usePluginContributions } from "@/src/hooks/usePluginContributions.ts";
import { useTeams } from "@/src/hooks/useTeams.ts";
import type { ChannelConfig } from "@/src/lib/api/channels.ts";

function toView(c: ChannelConfig): ChannelConfigView {
	return {
		id: c.id,
		name: c.name,
		channelType: c.channelType,
		enabled: c.enabled,
		agentId: c.agentId,
		teamId: c.teamId,
		groupReplyMode: c.groupReplyMode ?? "mentions",
		model: c.model,
		systemPrompt: c.systemPrompt,
		secrets: c.secrets ?? {},
		// Behaviour settings round-trip unmasked (they are configuration, not
		// credentials). Each falls back to the server's own default so a bot saved
		// before the field existed still opens with a coherent form.
		dmPolicy: c.dmPolicy ?? "pairing",
		groupPolicy: c.groupPolicy ?? "allowlist",
		dmAllowlist: c.dmAllowlist ?? [],
		groupAllowlist: c.groupAllowlist ?? [],
		typingIndicator: c.typingIndicator ?? true,
		publishCommands: c.publishCommands ?? true,
		richText: c.richText ?? true,
		streaming: c.streaming ?? false,
		voiceReply: c.voiceReply ?? "never",
		threadReplies: c.threadReplies ?? false,
		sendReadReceipts: c.sendReadReceipts ?? true,
		profileName: c.profileName ?? null,
		profileShortBio: c.profileShortBio ?? null,
		profileDescription: c.profileDescription ?? null,
	};
}

/**
 * The behaviour settings the form edits, lifted off the save payload.
 *
 * Listed explicitly rather than spread wholesale: the payload also carries
 * `secrets`, which the update path deliberately omits when nothing changed, so a
 * blanket spread would put an empty secrets map back on the wire and look like
 * an intentional clear.
 */
function behaviorFields(payload: ChannelSavePayload) {
	return {
		dmPolicy: payload.dmPolicy,
		groupPolicy: payload.groupPolicy,
		dmAllowlist: payload.dmAllowlist,
		groupAllowlist: payload.groupAllowlist,
		typingIndicator: payload.typingIndicator,
		publishCommands: payload.publishCommands,
		richText: payload.richText,
		streaming: payload.streaming,
		voiceReply: payload.voiceReply,
		threadReplies: payload.threadReplies,
		sendReadReceipts: payload.sendReadReceipts,
		profileName: payload.profileName,
		profileShortBio: payload.profileShortBio,
		profileDescription: payload.profileDescription,
	};
}

export default function ChannelsPage({
	initialNew = false,
	initialSelectedId = null,
}: {
	initialNew?: boolean;
	initialSelectedId?: string | null;
}) {
	const { channels, loading, error, authed, create, update, remove } =
		useChannels();
	const { agents } = useAgents();
	const { teams } = useTeams();
	// Adapter types contributed by enabled plugins — surfaced as disabled options
	// in the create picker (functional channels await the plugin runtime).
	const { channels: pluginChannels } = usePluginContributions();

	const [saving, setSaving] = useState(false);

	const handleSave = async (
		payload: ChannelSavePayload,
		ctx: { isNew: boolean; id: string | null }
	): Promise<boolean> => {
		setSaving(true);
		try {
			const hasSecrets = Object.keys(payload.secrets).length > 0;
			if (ctx.isNew) {
				await create({
					channelType: payload.channelType,
					name: payload.name,
					secrets: payload.secrets,
					agentId: payload.agentId,
					teamId: payload.teamId,
					groupReplyMode: payload.groupReplyMode,
					model: payload.model,
					systemPrompt: payload.systemPrompt,
					enabled: payload.enabled,
					...behaviorFields(payload),
				});
			} else if (ctx.id) {
				await update(ctx.id, {
					name: payload.name,
					...(hasSecrets ? { secrets: payload.secrets } : {}),
					agentId: payload.agentId,
					teamId: payload.teamId,
					groupReplyMode: payload.groupReplyMode,
					model: payload.model,
					systemPrompt: payload.systemPrompt,
					enabled: payload.enabled,
					...behaviorFields(payload),
				});
			}
			return true;
		} catch {
			// The view surfaces validation errors; backend errors fall back to the
			// list error state on next refresh.
			return false;
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (id: string) => {
		const channel = channels.find((c) => c.id === id);
		if (!window.confirm(`Delete the "${channel?.name ?? id}" bot?`)) {
			return;
		}
		try {
			await remove(id);
		} catch {
			// Surfaced via the list error state on next refresh.
		}
	};

	// Sidebar is the channel picker; this page is create/edit only (no in-page
	// list). Bots are account-global on the gateway — not scoped to the active node.
	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="min-h-0 flex-1 overflow-hidden">
				<ChannelsView
					agents={agents.map((a) => ({ id: a.id, name: a.name }))}
					authed={authed}
					channels={channels.map(toView)}
					error={error}
					initialNew={initialNew}
					initialSelectedId={initialSelectedId}
					loading={loading}
					onDelete={handleDelete}
					onSave={handleSave}
					pluginPlatforms={pluginChannels.map((c) => ({
						id: c.id,
						name: c.name,
						platform: c.platform,
					}))}
					saving={saving}
					teams={teams.map((t) => ({ id: t.id, name: t.name }))}
				/>
			</div>
		</div>
	);
}
