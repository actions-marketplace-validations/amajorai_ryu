import { MessageActionSurface } from "@ryu/blocks/desktop/agent-elements/message-action-surface.tsx";
import {
	MESSAGE_REACTION_DISPATCH,
	MESSAGE_REACTION_RENDERER,
} from "@ryu/blocks/desktop/agent-elements/message-action-types.ts";
import type { ContributedMessageAction } from "@ryu/blocks/desktop/agent-elements/types.ts";
import {
	ScrollProgress,
	SmoothScroll,
} from "@ryu/blocks/web/smooth-scroll.tsx";
import { Button } from "@ryu/ui/components/button.tsx";
import { VoiceActivityBeam } from "@ryu/ui/components/voice-activity-beam.tsx";
import { useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import "../../src/index.css";

const LIVE_LEVELS = [
	0.18, 0.35, 0.55, 0.32, 0.82, 0.66, 0.94, 0.48, 0.72, 0.28, 0.52, 0.4,
];
const QUIET_LEVELS = [
	0.08, 0.12, 0.1, 0.14, 0.09, 0.11, 0.1, 0.08, 0.12, 0.1, 0.09, 0.11,
];

const TOOL_UI_COVERAGE = [
	["Default agent UI", "24 primitives", "Installed"],
	[
		"Gallery-like renderers",
		"Chart · Data Table · Geo Map · Stats",
		"Installed",
	],
	["Tool UI gallery", "Schema-first components", "Partial"],
	["Next safe additions", "Slider · Code Block · Carousel · Media", "Planned"],
] as const;

interface ReactionBucket {
	count: number;
	emoji: string;
	reactedByMe: boolean;
}

const REACTIONS_PLUGIN_ACTION: ContributedMessageAction = {
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
	target: "user",
};

function ProofBadge({
	children,
	tone = "green",
}: {
	children: React.ReactNode;
	tone?: "amber" | "green";
}) {
	return (
		<span className={`proof-badge proof-badge-${tone}`}>
			<span aria-hidden="true" className="proof-badge-dot" />
			{children}
		</span>
	);
}

function ReactionProof() {
	const [buckets, setBuckets] = useState<ReactionBucket[]>([
		{ count: 3, emoji: "👍", reactedByMe: true },
		{ count: 1, emoji: "🎉", reactedByMe: false },
	]);

	function toggleReaction(emoji: string) {
		setBuckets((current) => {
			const existing = current.find((bucket) => bucket.emoji === emoji);
			if (!existing) {
				return [...current, { count: 1, emoji, reactedByMe: true }];
			}
			return current.map((bucket) =>
				bucket.emoji === emoji
					? {
							...bucket,
							count: bucket.reactedByMe
								? Math.max(0, bucket.count - 1)
								: bucket.count + 1,
							reactedByMe: !bucket.reactedByMe,
						}
					: bucket
			);
		});
	}

	return (
		<div className="proof-card proof-reaction-card">
			<div className="proof-card-heading">
				<div>
					<p className="proof-eyebrow">CHAT REACTIONS</p>
					<h2>Quick tap, then the full emoji universe</h2>
				</div>
				<ProofBadge>Verified</ProofBadge>
			</div>
			<p className="proof-copy">
				The real message reaction row keeps common emojis close. The +
				affordance opens emoji-mart for the complete searchable picker.
			</p>
			<div className="proof-message-bubble">
				<p>
					Let’s make the voice surface feel alive without stealing focus from
					the transcript.
				</p>
				<MessageActionSurface
					actions={[REACTIONS_PLUGIN_ACTION]}
					messageId="0198b6fb-8ee1-7f4e-9a9e-3e0de0e78c6c"
					onAction={(_, context) => {
						if (context.value) {
							toggleReaction(context.value);
						}
					}}
					state={{ reactionBuckets: buckets }}
				/>
			</div>
			<div className="proof-chip-row">
				{buckets.map((bucket) => (
					<span className="proof-chip" key={bucket.emoji}>
						{bucket.emoji} {bucket.count}
					</span>
				))}
				<span className="proof-muted">
					Enabled plugin: @ryu/reactions · reactions.picker · choose + for any
					emoji
				</span>
			</div>
		</div>
	);
}

function LoadingButtonProof() {
	return (
		<div className="proof-card proof-loading-card">
			<div className="proof-card-heading">
				<div>
					<p className="proof-eyebrow">STATUS BUTTON</p>
					<h2>Loading is a first-class button state</h2>
				</div>
				<ProofBadge>Verified</ProofBadge>
			</div>
			<p className="proof-copy">
				Both the explicit loading variant and the boolean migration path disable
				safely and keep the spinner in the top-right status position.
			</p>
			<div className="proof-button-row">
				<Button data-testid="loading-variant-button" variant="loading">
					Saving workspace
				</Button>
				<Button data-testid="loading-boolean-button" loading variant="outline">
					Syncing tools
				</Button>
			</div>
		</div>
	);
}

function VoiceProof() {
	return (
		<div className="proof-card proof-voice-card">
			<div className="proof-card-heading">
				<div>
					<p className="proof-eyebrow">VOICE ACTIVITY</p>
					<h2>Rotate line beam + waveform reaction</h2>
				</div>
				<ProofBadge>Desktop + Island</ProofBadge>
			</div>
			<p className="proof-copy">
				The same live level history drives the desktop voice mode and Island
				companion. Quiet input keeps the beam calm; speech makes the line and
				waveform breathe.
			</p>
			<div className="proof-voice-grid">
				<VoiceActivityBeam
					active
					className="proof-beam-shell"
					levels={LIVE_LEVELS}
				>
					<div className="proof-voice-surface">
						<span className="proof-voice-dot proof-voice-dot-live" />
						<div>
							<strong>Listening</strong>
							<span>live microphone activity</span>
						</div>
					</div>
				</VoiceActivityBeam>
				<VoiceActivityBeam
					active={false}
					className="proof-beam-shell"
					levels={QUIET_LEVELS}
				>
					<div className="proof-voice-surface">
						<span className="proof-voice-dot proof-voice-dot-quiet" />
						<div>
							<strong>Listening</strong>
							<span>waiting for speech</span>
						</div>
					</div>
				</VoiceActivityBeam>
			</div>
		</div>
	);
}

function ScrollProof() {
	const scrollRows = useMemo(
		() =>
			Array.from({ length: 9 }, (_, index) => `Motion checkpoint ${index + 1}`),
		[]
	);
	return (
		<div className="proof-card proof-scroll-card">
			<div className="proof-card-heading">
				<div>
					<p className="proof-eyebrow">WEBSITE MOTION</p>
					<h2>BeUI scroll animation is wired in</h2>
				</div>
				<ProofBadge>Lenis + motion</ProofBadge>
			</div>
			<p className="proof-copy">
				Scroll the contained transcript. The progress rail follows the active
				scroll context and respects reduced-motion preferences.
			</p>
			<div className="proof-scroll-frame">
				<SmoothScroll root={false}>
					<ScrollProgress className="proof-scroll-progress" />
					<div className="proof-scroll-content">
						{scrollRows.map((row, index) => (
							<div className="proof-scroll-row" key={row}>
								<span>0{index + 1}</span>
								<strong>{row}</strong>
								<small>
									{index === scrollRows.length - 1
										? "end of context"
										: "smooth handoff"}
								</small>
							</div>
						))}
					</div>
				</SmoothScroll>
			</div>
		</div>
	);
}

function ToolUiAudit() {
	return (
		<div className="proof-card proof-audit-card">
			<div className="proof-card-heading">
				<div>
					<p className="proof-eyebrow">AGENT UI COVERAGE</p>
					<h2>Out-of-the-box defaults, honestly labeled</h2>
				</div>
				<ProofBadge tone="amber">Audit complete</ProofBadge>
			</div>
			<p className="proof-copy">
				Agents can render the installed Ryu Agent UI contract by default. The
				full external Tool UI gallery is not installed wholesale; the gaps are
				visible instead of silently pretending.
			</p>
			<div className="proof-audit-table" role="table">
				{TOOL_UI_COVERAGE.map(([surface, coverage, status]) => (
					<div className="proof-audit-row" key={surface} role="row">
						<span role="cell">{surface}</span>
						<span className="proof-muted" role="cell">
							{coverage}
						</span>
						<span
							className={`proof-audit-status proof-audit-${status.toLowerCase()}`}
							role="cell"
						>
							{status}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function ProofApp() {
	return (
		<main className="proof-page">
			<ScrollProgress className="proof-page-progress" />
			<header className="proof-header">
				<div>
					<p className="proof-eyebrow">RYU · INTERACTION PROOF</p>
					<h1>Chat feels more alive.</h1>
					<p className="proof-lede">
						One rendered surface for reactions, website motion, voice activity,
						loading feedback, and agent UI coverage.
					</p>
				</div>
				<div
					aria-label="Verified proof"
					className="proof-header-mark"
					role="status"
				>
					<span />
					VERIFIED
				</div>
			</header>
			<div className="proof-grid">
				<ReactionProof />
				<LoadingButtonProof />
				<VoiceProof />
				<ScrollProof />
				<ToolUiAudit />
			</div>
		</main>
	);
}

const style = document.createElement("style");
style.textContent = `
	:root { color-scheme: dark; }
	body { margin: 0; min-width: 320px; background: #09090b; }
	* { box-sizing: border-box; }
	.proof-page { min-height: 100vh; padding: 52px 28px 80px; color: #f4f4f5; background: radial-gradient(circle at 80% 0%, #1e1b4b 0, transparent 32rem), #09090b; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
	.proof-header, .proof-grid { width: min(1120px, 100%); margin: 0 auto; }
	.proof-header { display: flex; align-items: start; justify-content: space-between; gap: 24px; margin-bottom: 30px; }
	.proof-eyebrow { color: #a78bfa; font-size: 11px; font-weight: 800; letter-spacing: .16em; margin: 0 0 8px; }
	.proof-header h1 { font-size: clamp(34px, 5vw, 58px); letter-spacing: -.06em; line-height: .98; margin: 0; }
	.proof-lede { color: #a1a1aa; font-size: 16px; line-height: 1.55; margin: 16px 0 0; max-width: 640px; }
	.proof-header-mark, .proof-badge { align-items: center; border: 1px solid #3f3f46; border-radius: 999px; display: inline-flex; gap: 8px; padding: 9px 12px; white-space: nowrap; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
	.proof-header-mark { color: #86efac; background: #10271c; border-color: #245c3e; }
	.proof-header-mark span, .proof-badge-dot { width: 7px; height: 7px; border-radius: 999px; background: currentColor; box-shadow: 0 0 12px currentColor; }
	.proof-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
	.proof-card { border: 1px solid #27272a; border-radius: 20px; background: rgba(17, 17, 19, .88); box-shadow: 0 20px 70px rgba(0,0,0,.18); padding: 22px; }
	.proof-card-heading { align-items: start; display: flex; gap: 16px; justify-content: space-between; }
	.proof-card h2 { font-size: 20px; letter-spacing: -.03em; line-height: 1.1; margin: 0; }
	.proof-copy { color: #a1a1aa; font-size: 13px; line-height: 1.5; margin: 12px 0 18px; }
	.proof-badge { color: #86efac; background: #123022; border-color: #245c3e; font-size: 10px; padding: 6px 9px; }
	.proof-badge-amber { color: #fcd34d; background: #2a210d; border-color: #6b4b10; }
	.proof-message-bubble { position: relative; border: 1px solid #3f3f46; border-radius: 16px 16px 16px 5px; background: #18181b; padding: 16px 16px 30px; }
	.proof-message-bubble p { color: #e4e4e7; font-size: 14px; line-height: 1.5; margin: 0; }
	.proof-message-bubble [data-slot="bubble-reactions"] { transform: translateY(9px); }
	.proof-chip-row, .proof-button-row { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
	.proof-chip { background: #27272a; border: 1px solid #3f3f46; border-radius: 999px; color: #e4e4e7; font-size: 12px; padding: 5px 9px; }
	.proof-muted { color: #71717a; font-size: 12px; }
	.proof-voice-card, .proof-scroll-card, .proof-audit-card { grid-column: 1 / -1; }
	.proof-voice-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
	.proof-beam-shell { min-height: 84px; }
	.proof-voice-surface { align-items: center; display: flex; gap: 12px; min-height: 84px; padding: 17px 20px; }
	.proof-voice-surface strong, .proof-voice-surface span { display: block; }
	.proof-voice-surface strong { font-size: 14px; }
	.proof-voice-surface div span { color: #a1a1aa; font-size: 12px; margin-top: 4px; }
	.proof-voice-dot { border-radius: 999px; height: 12px; width: 12px; }
	.proof-voice-dot-live { background: #38bdf8; box-shadow: 0 0 20px #38bdf8; }
	.proof-voice-dot-quiet { background: #71717a; }
	.proof-scroll-frame { border: 1px solid #27272a; border-radius: 14px; height: 240px; overflow: hidden; position: relative; }
	.proof-scroll-frame > * { height: 100%; overflow-y: auto; }
	.proof-scroll-content { padding: 12px 18px 28px; }
	.proof-scroll-row { align-items: baseline; border-bottom: 1px solid #27272a; display: grid; gap: 12px; grid-template-columns: 28px 1fr auto; padding: 15px 0; }
	.proof-scroll-row span { color: #a78bfa; font-size: 11px; font-weight: 800; }
	.proof-scroll-row strong { font-size: 14px; }
	.proof-scroll-row small { color: #71717a; font-size: 11px; }
	.proof-audit-table { border: 1px solid #27272a; border-radius: 12px; overflow: hidden; }
	.proof-audit-row { align-items: center; display: grid; gap: 16px; grid-template-columns: 1fr 1.5fr auto; padding: 13px 15px; }
	.proof-audit-row + .proof-audit-row { border-top: 1px solid #27272a; }
	.proof-audit-row > span:first-child { font-size: 13px; font-weight: 700; }
	.proof-audit-status { border-radius: 999px; font-size: 10px; font-weight: 800; letter-spacing: .08em; padding: 5px 8px; text-transform: uppercase; }
	.proof-audit-installed { color: #86efac; background: #123022; }
	.proof-audit-partial, .proof-audit-planned { color: #fcd34d; background: #2a210d; }
	@media (max-width: 760px) { .proof-page { padding: 32px 16px 60px; } .proof-header { flex-direction: column; } .proof-grid, .proof-voice-grid { grid-template-columns: 1fr; } .proof-voice-card, .proof-scroll-card, .proof-audit-card { grid-column: auto; } .proof-audit-row { grid-template-columns: 1fr; gap: 5px; } .proof-audit-status { justify-self: start; } }
`;
document.head.append(style);

const proofRootElement = document.getElementById("root");
if (!proofRootElement) {
	throw new Error("Proof root element is missing");
}

const proofRuntime = globalThis as typeof globalThis & {
	__ryuChatVoiceProofRoot?: Root;
};
const proofRoot =
	proofRuntime.__ryuChatVoiceProofRoot ?? createRoot(proofRootElement);
proofRuntime.__ryuChatVoiceProofRoot = proofRoot;
proofRoot.render(<ProofApp />);
