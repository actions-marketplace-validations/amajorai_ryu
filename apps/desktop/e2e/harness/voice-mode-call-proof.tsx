import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { VoiceMode } from "../../src/hooks/useVoiceMode.ts";
import { VoiceModeCallScreen } from "../../src/components/voice/VoiceModeCallScreen.tsx";
import "../../src/index.css";

const LEVELS = [
	0.12, 0.24, 0.46, 0.32, 0.76, 0.58, 0.9, 0.42, 0.68, 0.3, 0.5, 0.22,
];

const TURNS: VoiceMode["turns"] = [
	{
		id: "u-1",
		role: "user",
		text: "Can you walk me through the next step?",
	},
	{
		id: "a-1",
		role: "assistant",
		text: "Absolutely. I will keep the next step focused and easy to follow.",
	},
];

function Proof() {
	const [elapsedSeconds, setElapsedSeconds] = useState(84);
	const [muted, setMuted] = useState(false);
	const [ended, setEnded] = useState(false);

	useEffect(() => {
		if (ended) {
			return;
		}
		const timer = window.setInterval(
			() => setElapsedSeconds((current) => current + 1),
			1000
		);
		return () => window.clearInterval(timer);
	}, [ended]);

	if (ended) {
		return (
			<main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
				<div className="rounded-2xl border border-border bg-card px-8 py-7 text-center shadow-xl">
					<p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.14em]">
						Voice call
					</p>
					<h1 className="mt-2 font-semibold text-xl">Call ended</h1>
					<p className="mt-2 text-muted-foreground text-sm">
						The session returned to the composer.
					</p>
				</div>
			</main>
		);
	}

	const voice: VoiceMode = {
		agentName: "Ryu Assistant",
		active: true,
		caption: "",
		error: null,
		elapsedSeconds,
		interrupt: () => undefined,
		levels: muted ? new Array(24).fill(0) : LEVELS,
		muted,
		phase: "listening",
		start: () => undefined,
		stop: () => setEnded(true),
		toggleMute: () => setMuted((current) => !current),
		transcript: "",
		turns: TURNS,
	};

	return <VoiceModeCallScreen showTranscript voice={voice} />;
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
		<Proof />
	</ThemeProvider>
);
