import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { VoiceMode } from "@/src/hooks/useVoiceMode.ts";
import { VoiceModeCallScreen } from "./VoiceModeCallScreen.tsx";

const VOICE: VoiceMode = {
	agentName: "Nova Assistant",
	active: true,
	caption: "I found the next step.",
	error: "",
	elapsedSeconds: 83,
	interrupt: () => undefined,
	levels: [0.2, 0.7, 0.4],
	muted: false,
	phase: "speaking",
	start: () => undefined,
	stop: () => undefined,
	toggleMute: () => undefined,
	transcript: "What should I do next?",
	turns: [
		{ id: "u-1", role: "user", text: "What should I do next?" },
		{ id: "a-1", role: "assistant", text: "I found the next step." },
	],
};

test("renders the compact call identity, timer, transcript, and controls", () => {
	const markup = renderToStaticMarkup(
		<VoiceModeCallScreen showTranscript voice={VOICE} />
	);

	expect(markup).toContain('data-testid="voice-call-screen"');
	expect(markup).toContain("Nova Assistant");
	expect(markup).toContain('data-testid="voice-call-duration">01:23');
	expect(markup).toContain('data-testid="voice-call-transcript"');
	expect(markup).toContain('aria-label="Mute microphone"');
	expect(markup).toContain('aria-label="Interrupt response"');
	expect(markup).toContain('aria-label="End call"');
});

test("keeps errors visible when the transcript is hidden", () => {
	const markup = renderToStaticMarkup(
		<VoiceModeCallScreen
			showTranscript={false}
			voice={{ ...VOICE, error: "Microphone permission is required." }}
		/>
	);

	expect(markup).not.toContain('data-testid="voice-call-transcript"');
	expect(markup).toContain('role="alert"');
	expect(markup).toContain("Microphone permission is required.");
});
