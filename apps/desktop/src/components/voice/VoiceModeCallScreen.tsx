import { VoiceActivityBeam } from "@ryu/ui/components/voice-activity-beam.tsx";
import {
	Mic,
	MicOff,
	PhoneOff,
	Square,
	X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef } from "react";
import { widgetDefinition } from "@/src/components/dashboard/widgets/registry.tsx";
import type { VoiceMode } from "@/src/hooks/useVoiceMode.ts";
import { extractVoiceWidgets } from "./voice-widgets.ts";
import { formatVoiceCallDuration, getVoiceCallInitials } from "./voice-call.ts";

interface VoicePhaseMeta {
	detail: string;
	dot: string;
	label: string;
	pulse: boolean;
}

const PHASE_META: Record<VoiceMode["phase"], VoicePhaseMeta> = {
	connecting: {
		detail: "Starting your microphone",
		dot: "bg-muted-foreground",
		label: "Connecting",
		pulse: false,
	},
	idle: {
		detail: "Waiting for you to speak",
		dot: "bg-info",
		label: "Listening",
		pulse: true,
	},
	listening: {
		detail: "Listening for your voice",
		dot: "bg-info",
		label: "Listening",
		pulse: true,
	},
	thinking: {
		detail: "Preparing a response",
		dot: "bg-warning",
		label: "Thinking",
		pulse: true,
	},
	speaking: {
		detail: "Speaking to you",
		dot: "bg-success",
		label: "Speaking",
		pulse: true,
	},
};

interface VoiceModeCallScreenProps {
	showTranscript: boolean;
	voice: VoiceMode;
}

export function VoiceModeCallScreen({
	showTranscript,
	voice,
}: VoiceModeCallScreenProps) {
	const meta = PHASE_META[voice.phase];
	const canInterrupt = voice.phase === "speaking" || voice.phase === "thinking";
	const { resolvedTheme } = useTheme();
	const beamTheme = resolvedTheme === "light" ? "light" : "dark";

	const assistantText = useMemo(
		() =>
			voice.turns
				.filter((turn) => turn.role === "assistant")
				.map((turn) => turn.text)
				.join("\n\n"),
		[voice.turns]
	);
	const widgets = useMemo(
		() => extractVoiceWidgets(assistantText),
		[assistantText]
	);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: keep the newest call activity in view
	useEffect(() => {
		const element = scrollRef.current;
		if (element) {
			element.scrollTop = element.scrollHeight;
		}
	}, [voice.turns, voice.caption]);

	const liveText =
		voice.phase === "listening"
			? voice.transcript.trim()
			: voice.phase === "speaking"
				? voice.caption.trim()
				: "";
	const hasTurns = voice.turns.length > 0;
	const avatarLabel = getVoiceCallInitials(voice.agentName);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 py-5 backdrop-blur-xl">
			<section
				aria-label={`Voice call with ${voice.agentName}`}
				className="flex max-h-[calc(100vh-2.5rem)] w-full max-w-md flex-col overflow-hidden rounded-[2rem] border border-border/70 bg-card/95 shadow-2xl"
				data-testid="voice-call-screen"
			>
				<header className="flex items-start justify-between px-5 pt-4">
					<div>
						<p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.14em]">
							Voice call
						</p>
						<p
							aria-label="Call duration"
							className="mt-1 font-mono text-muted-foreground text-sm tabular-nums"
							data-testid="voice-call-duration"
						>
							{formatVoiceCallDuration(voice.elapsedSeconds)}
						</p>
					</div>
					<button
						aria-label="Exit voice mode"
						className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={voice.stop}
						type="button"
					>
						<X className="size-4" />
					</button>
				</header>

				<div className="flex min-h-0 flex-col items-center px-6 pt-7 pb-5">
					<div
						aria-hidden="true"
						className="flex size-20 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary text-xl ring-8 ring-primary/5"
					>
						{avatarLabel}
					</div>
					<p className="mt-5 font-medium text-muted-foreground text-xs uppercase tracking-[0.14em]">
						{voice.phase === "connecting" ? "Calling" : "Connected to"}
					</p>
					<h1 className="mt-1 text-center font-semibold text-2xl tracking-tight">
						{voice.agentName}
					</h1>
					<div
						aria-live="polite"
						className="mt-3 flex items-center gap-2 text-muted-foreground text-sm"
						role="status"
					>
						<span className="relative flex size-2.5 items-center justify-center">
							<span
								className={`absolute inline-flex size-full rounded-full ${meta.dot} opacity-60 ${meta.pulse ? "animate-ping motion-reduce:animate-none" : ""}`}
							/>
							<span
								className={`relative inline-flex size-2 rounded-full ${meta.dot}`}
							/>
						</span>
						<span>{meta.label}</span>
					</div>

					<VoiceActivityBeam
						active={voice.phase !== "connecting" && !voice.muted}
						className="mt-6 h-11 w-56"
						levels={voice.levels}
						theme={beamTheme}
					/>

					<div
						aria-live="polite"
						className="mt-4 min-h-10 text-center text-muted-foreground text-sm"
					>
						{liveText.length > 0 ? (
							<span className="text-foreground">“{liveText}”</span>
						) : (
							<span>{voice.muted ? "Microphone muted" : meta.detail}</span>
						)}
					</div>

					{voice.error && (
						<p className="mt-2 text-center text-destructive text-sm" role="alert">
							{voice.error}
						</p>
					)}
				</div>

				{showTranscript && (
					<div
						aria-label="Call transcript"
						className="scroll-fade min-h-20 max-h-52 space-y-3 overflow-y-auto border-border/60 border-t px-5 py-4"
						data-testid="voice-call-transcript"
						ref={scrollRef}
					>
						{hasTurns ? (
							voice.turns.map((turn) => (
								<div
									className={
										turn.role === "user"
											? "flex justify-end"
											: "flex justify-start"
									}
									key={turn.id}
								>
									<div
										className={`max-w-[86%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${turn.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
									>
										{displayText(turn.text)}
									</div>
								</div>
							))
						) : (
							<div className="flex items-center justify-center gap-2 py-3 text-muted-foreground text-sm">
								<Mic className="size-4" />
								Start speaking — your conversation shows here.
							</div>
						)}
						{widgets.length > 0 && (
							<div className="grid gap-3 pt-1 sm:grid-cols-2">
								{widgets.map((item) => (
									<div
										className="min-h-24 overflow-hidden rounded-xl border border-border/60 bg-background p-3"
										key={item.id}
									>
										{item.widget.title && (
											<div className="mb-2 truncate font-semibold text-sm tracking-tight">
												{item.widget.title}
											</div>
										)}
										{widgetDefinition(item.widget.kind)?.render({
											widget: item.widget,
											value: item.value,
										}) ?? null}
									</div>
								))}
							</div>
						)}
					</div>
				)}

				<footer className="flex flex-wrap items-center justify-center gap-3 border-border/60 border-t px-5 py-4">
					<button
						aria-label={
							voice.muted ? "Unmute microphone" : "Mute microphone"
						}
						aria-pressed={voice.muted}
						className={`flex min-w-24 items-center justify-center gap-2 rounded-full px-4 py-2.5 font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${voice.muted ? "bg-destructive/15 text-destructive hover:bg-destructive/20" : "bg-muted text-foreground hover:bg-muted/70"}`}
						onClick={voice.toggleMute}
						type="button"
					>
						{voice.muted ? (
							<MicOff className="size-4" />
						) : (
							<Mic className="size-4" />
						)}
						<span>{voice.muted ? "Unmute" : "Mute"}</span>
					</button>
					{canInterrupt && (
						<button
							aria-label="Interrupt response"
							className="flex min-w-24 items-center justify-center gap-2 rounded-full bg-muted px-4 py-2.5 font-medium text-foreground text-sm transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							onClick={voice.interrupt}
							type="button"
						>
							<Square className="size-3.5 fill-current" />
							<span>Interrupt</span>
						</button>
					)}
					<button
						aria-label="End call"
						className="flex min-w-28 items-center justify-center gap-2 rounded-full bg-destructive px-5 py-2.5 font-medium text-destructive-foreground text-sm shadow-sm transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
						data-testid="voice-call-end"
						onClick={voice.stop}
						type="button"
					>
						<PhoneOff className="size-4" />
						<span>End call</span>
					</button>
				</footer>
			</section>
		</div>
	);
}

/** Hide raw ```ryu-widget JSON from transcript bubbles; the block renders as a card. */
const WIDGET_BLOCK_RE = /```ryu-widget[\s\S]*?```/g;

function displayText(text: string): string {
	return text.replace(WIDGET_BLOCK_RE, "").trim();
}
