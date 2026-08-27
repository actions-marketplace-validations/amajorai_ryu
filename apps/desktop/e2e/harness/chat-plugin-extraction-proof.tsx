import { MessageActionSurface } from "@ryu/blocks/desktop/agent-elements/message-action-surface.tsx";
import {
	isMessageReactionAction,
	MESSAGE_REACTION_DISPATCH,
	MESSAGE_REACTION_RENDERER,
} from "@ryu/blocks/desktop/agent-elements/message-action-types.ts";
import type {
	ContributedMessageAction,
	MessageActionRuntimeState,
} from "@ryu/blocks/desktop/agent-elements/types.ts";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PluginChatFeature } from "@/src/lib/api/plugins.ts";
import {
	buildSideChatContext,
	GHOST_CHAT_FEATURE_KIND,
	GHOST_CHATS_PLUGIN_ID,
	hasPluginChatFeature,
	SIDE_CHAT_FEATURE_KIND,
	SIDE_CHATS_PLUGIN_ID,
} from "@/src/lib/plugin-chat-features.ts";
import "../../src/index.css";

const CHAT_FEATURES: PluginChatFeature[] = [
	{
		context: "main-chat",
		id: "side-chats",
		kind: SIDE_CHAT_FEATURE_KIND,
		persistence: "parent-conversation",
		plugin: SIDE_CHATS_PLUGIN_ID,
		command: "/btw",
	},
	{
		id: "ghost-chats",
		kind: GHOST_CHAT_FEATURE_KIND,
		persistence: "none",
		plugin: GHOST_CHATS_PLUGIN_ID,
		renderer: "temporary-chat",
		scope: "current-tab",
	},
];

const REACTION_ACTION: ContributedMessageAction = {
	args: {
		dispatch: MESSAGE_REACTION_DISPATCH,
		renderer: MESSAGE_REACTION_RENDERER,
	},
	capability: "reactions.toggle",
	icon: "smile",
	id: "reactions.picker",
	kind: "menu",
	label: "Add reaction",
	order: 100,
	plugin: "@ryu/reactions",
	target: "any",
};

const MAIN_CHAT_MESSAGES = [
	{
		content: "We chose the local model for the first pass.",
		role: "user",
	},
	{
		content: "The latest answer is still streaming in this main chat.",
		role: "assistant",
	},
];

const SIDE_CHAT_CONTEXT = buildSideChatContext(MAIN_CHAT_MESSAGES);

interface ReactionBucket {
	count: number;
	emoji: string;
	reactedByMe: boolean;
}

function StatusPill({ children }: { children: React.ReactNode }) {
	return <span className="proof-pill">{children}</span>;
}

function FeatureRow({
	detail,
	feature,
	verified,
}: {
	detail: string;
	feature: string;
	verified: boolean;
}) {
	return (
		<div className="feature-row" data-testid={`${feature}-feature-row`}>
			<div className="feature-row-main">
				<span className={`feature-dot ${verified ? "feature-dot-on" : ""}`} />
				<div>
					<strong>{feature}</strong>
					<span>{detail}</span>
				</div>
			</div>
			<StatusPill>{verified ? "Enabled" : "Missing"}</StatusPill>
		</div>
	);
}

function ChatPluginExtractionProof() {
	const [temporaryActive, setTemporaryActive] = useState(false);
	const [reactionBuckets, setReactionBuckets] = useState<ReactionBucket[]>([
		{ count: 2, emoji: "👍", reactedByMe: false },
	]);
	const reactionState = useMemo<MessageActionRuntimeState>(
		() => ({ reactionBuckets }),
		[reactionBuckets]
	);
	const sideChatsEnabled = hasPluginChatFeature(
		CHAT_FEATURES,
		SIDE_CHATS_PLUGIN_ID,
		SIDE_CHAT_FEATURE_KIND
	);
	const ghostChatsEnabled = hasPluginChatFeature(
		CHAT_FEATURES,
		GHOST_CHATS_PLUGIN_ID,
		GHOST_CHAT_FEATURE_KIND
	);

	return (
		<main className="proof-page" data-testid="chat-plugin-proof">
			<header className="proof-header">
				<div>
					<p className="proof-kicker">RYU · CHAT PLUGIN EXTRACTION</p>
					<h1>Chat surfaces have clear owners.</h1>
					<p className="proof-lede">
						One enabled-contribution feed drives side-chat context, message
						reactions, and temporary-chat privacy without hardcoded
						discoverability.
					</p>
				</div>
				<div className="proof-verified" role="status">
					<span /> VERIFIED IN REACT
				</div>
			</header>

			<section className="proof-card proof-overview">
				<div className="card-heading">
					<div>
						<p className="proof-kicker">ENABLED PLUGIN FEED</p>
						<h2>Three independent chat capabilities</h2>
					</div>
					<StatusPill>Feature-detected</StatusPill>
				</div>
				<div className="feature-list">
					<FeatureRow
						detail="/btw · main-chat context · parent conversation persistence"
						feature={SIDE_CHATS_PLUGIN_ID}
						verified={sideChatsEnabled}
					/>
					<FeatureRow
						detail="message_actions · reactions.picker · reactions.toggle"
						feature="@ryu/reactions"
						verified={isMessageReactionAction(REACTION_ACTION)}
					/>
					<FeatureRow
						detail="temporary-chat · current tab · persistence none"
						feature={GHOST_CHATS_PLUGIN_ID}
						verified={ghostChatsEnabled}
					/>
				</div>
			</section>

			<section className="proof-card" data-testid="side-chat-context-proof">
				<div className="card-heading">
					<div>
						<p className="proof-kicker">@RYU/SIDE-CHATS</p>
						<h2>Side questions inherit the main chat</h2>
					</div>
					<StatusPill>Context attached</StatusPill>
				</div>
				<p className="proof-copy">
					The host sends the visible user and assistant turns with the `/btw`
					request. The server caps the handoff at the latest 30 messages.
				</p>
				<div className="context-trace">
					<div className="trace-label">
						<span>POST /api/btw</span>
						<code>conversation_id + messages[]</code>
					</div>
					<div
						className="context-messages"
						data-testid="side-chat-context-messages"
					>
						{SIDE_CHAT_CONTEXT.map((message, index) => (
							<div className="context-message" key={`${message.role}-${index}`}>
								<span>{message.role}</span>
								<p>{message.content}</p>
							</div>
						))}
					</div>
					<code
						className="context-json"
						data-testid="side-chat-context-payload"
					>
						{JSON.stringify(SIDE_CHAT_CONTEXT)}
					</code>
				</div>
			</section>

			<section className="proof-card" data-testid="ghost-chat-proof">
				<div className="card-heading">
					<div>
						<p className="proof-kicker">@RYU/GHOST-CHATS</p>
						<h2>Temporary chats stay private to this tab</h2>
					</div>
					<StatusPill>{temporaryActive ? "Active" : "Ready"}</StatusPill>
				</div>
				<p className="proof-copy">
					The plugin owns the lifecycle declaration; the host enforces the
					native privacy boundary for each turn.
				</p>
				<button
					aria-pressed={temporaryActive}
					className={`temporary-toggle ${temporaryActive ? "temporary-toggle-active" : ""}`}
					data-testid="ghost-chat-toggle"
					onClick={() => setTemporaryActive((active) => !active)}
					type="button"
				>
					<span className="toggle-knob" />
					Temporary chat
				</button>
				<div className="privacy-grid" data-testid="ghost-chat-lifecycle">
					<span>persist</span>
					<strong>{temporaryActive ? "false" : "true"}</strong>
					<span>history / drafts / presence / reactions</span>
					<strong>{temporaryActive ? "skipped" : "normal"}</strong>
				</div>
			</section>

			<section
				className="proof-card proof-reaction-card"
				data-testid="reaction-proof"
			>
				<div className="card-heading">
					<div>
						<p className="proof-kicker">@RYU/REACTIONS</p>
						<h2>Reactions are a message-action plugin</h2>
					</div>
					<StatusPill>Native renderer</StatusPill>
				</div>
				<p className="proof-copy">
					The contribution enables the existing safe native picker and its Core
					persistence gate. No reaction declaration means no reaction row.
				</p>
				<div className="reaction-bubble">
					<p>
						The message action receives the owning plugin’s declared dispatch.
					</p>
					<MessageActionSurface
						actions={[REACTION_ACTION]}
						messageId="0198b6fb-8ee1-7f4e-9a9e-3e0de0e78c6c"
						onAction={(action, context) => {
							if (isMessageReactionAction(action) && context.value) {
								setReactionBuckets((current) => [
									...current,
									{
										count: 1,
										emoji: context.value ?? "",
										reactedByMe: true,
									},
								]);
							}
						}}
						state={reactionState}
					/>
				</div>
				<div className="reaction-summary">
					{reactionBuckets.map((bucket) => (
						<span key={bucket.emoji}>
							{bucket.emoji} {bucket.count}
						</span>
					))}
					<code>reactions.picker → reactions.toggle</code>
				</div>
			</section>
		</main>
	);
}

const style = document.createElement("style");
style.textContent = `
	:root { color-scheme: dark; }
	body { margin: 0; min-width: 320px; background: #08080a; }
	* { box-sizing: border-box; }
	.proof-page { min-height: 100vh; padding: 48px 24px 72px; color: #f4f4f5; background: radial-gradient(circle at 80% 0%, #29204f 0, transparent 34rem), #08080a; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
	.proof-header, .proof-card { width: min(1040px, 100%); margin-inline: auto; }
	.proof-header { display: flex; align-items: start; justify-content: space-between; gap: 24px; margin-bottom: 18px; }
	.proof-kicker { color: #a78bfa; font-size: 10px; font-weight: 800; letter-spacing: .16em; margin: 0 0 8px; }
	.proof-header h1 { max-width: 700px; font-size: clamp(34px, 6vw, 62px); letter-spacing: -.065em; line-height: .96; margin: 0; }
	.proof-lede { max-width: 640px; color: #a1a1aa; font-size: 15px; line-height: 1.55; margin: 16px 0 0; }
	.proof-verified, .proof-pill { align-items: center; border: 1px solid #285b3d; border-radius: 999px; color: #86efac; display: inline-flex; gap: 8px; padding: 7px 10px; white-space: nowrap; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
	.proof-verified { background: #10271c; padding: 10px 13px; }
	.proof-verified span, .feature-dot { width: 7px; height: 7px; border-radius: 999px; background: #52525b; }
	.proof-verified span, .feature-dot-on { background: #86efac; box-shadow: 0 0 12px #86efac; }
	.proof-card { border: 1px solid #27272a; border-radius: 20px; background: rgba(17, 17, 19, .9); box-shadow: 0 20px 70px rgba(0,0,0,.2); padding: 22px; margin-bottom: 14px; }
	.card-heading { align-items: start; display: flex; gap: 16px; justify-content: space-between; }
	.proof-card h2 { font-size: 20px; letter-spacing: -.035em; line-height: 1.1; margin: 0; }
	.proof-copy { color: #a1a1aa; font-size: 13px; line-height: 1.5; margin: 12px 0 18px; }
	.feature-list { border: 1px solid #27272a; border-radius: 14px; overflow: hidden; margin-top: 18px; }
	.feature-row { align-items: center; display: flex; gap: 14px; justify-content: space-between; padding: 13px 15px; }
	.feature-row + .feature-row { border-top: 1px solid #27272a; }
	.feature-row-main { align-items: center; display: flex; gap: 11px; min-width: 0; }
	.feature-row-main div { min-width: 0; }
	.feature-row-main strong, .feature-row-main span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.feature-row-main strong { font-size: 13px; }
	.feature-row-main div span { color: #71717a; font-size: 11px; margin-top: 3px; }
	.proof-pill { background: #123022; }
	.context-trace { border: 1px solid #3f3f46; border-radius: 14px; background: #101013; padding: 14px; }
	.trace-label { align-items: baseline; display: flex; gap: 10px; justify-content: space-between; margin-bottom: 10px; }
	.trace-label span { color: #e4e4e7; font-size: 12px; font-weight: 700; }
	.trace-label code, .context-json, .reaction-summary code { color: #a78bfa; font-size: 10px; }
	.context-messages { display: grid; gap: 7px; }
	.context-message { border-left: 2px solid #6d28d9; padding: 7px 10px; background: #18181b; }
	.context-message span { color: #a78bfa; font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
	.context-message p { color: #e4e4e7; font-size: 12px; line-height: 1.4; margin: 4px 0 0; }
	.context-json { display: block; line-height: 1.45; margin-top: 11px; overflow-wrap: anywhere; white-space: normal; }
	.temporary-toggle { align-items: center; background: #27272a; border: 1px solid #52525b; border-radius: 999px; color: #e4e4e7; cursor: pointer; display: inline-flex; gap: 9px; padding: 8px 13px 8px 9px; font: inherit; font-size: 12px; }
	.temporary-toggle-active { background: #3b276d; border-color: #8b5cf6; color: #ede9fe; }
	.toggle-knob { background: #71717a; border-radius: 999px; height: 14px; width: 14px; }
	.temporary-toggle-active .toggle-knob { background: #c4b5fd; box-shadow: 0 0 12px #a78bfa; }
	.privacy-grid { display: grid; grid-template-columns: 1fr auto; gap: 8px 15px; margin-top: 18px; padding-top: 14px; border-top: 1px solid #27272a; color: #a1a1aa; font-size: 12px; }
	.privacy-grid strong { color: #86efac; font-size: 11px; text-transform: uppercase; }
	.reaction-bubble { border: 1px solid #3f3f46; border-radius: 15px 15px 15px 5px; background: #18181b; padding: 15px 15px 28px; }
	.reaction-bubble p { color: #e4e4e7; font-size: 13px; line-height: 1.5; margin: 0; }
	.reaction-bubble [data-slot="bubble-reactions"] { transform: translateY(8px); }
	.reaction-summary { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 15px; }
	.reaction-summary span { border: 1px solid #3f3f46; border-radius: 999px; background: #27272a; color: #e4e4e7; font-size: 12px; padding: 5px 9px; }
	@media (max-width: 720px) { .proof-page { padding: 32px 15px 56px; } .proof-header { flex-direction: column; } .feature-row { align-items: start; flex-direction: column; } .trace-label { align-items: start; flex-direction: column; } }
`;
document.head.append(style);

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Chat plugin proof root is missing");
}
createRoot(rootElement).render(<ChatPluginExtractionProof />);
