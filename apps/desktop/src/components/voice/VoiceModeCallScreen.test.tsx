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
	expect(markup).toContain(
		'class="relative flex items-start justify-center px-5 pt-4"'
	);
	expect(markup).toContain('class="mt-1 text-center font-mono');
	expect(markup).toContain("font-medium tracking-tight");
	expect(markup).not.toContain("bg-card/95");
	expect(markup).not.toContain("shadow-2xl");
	expect(markup).toContain('data-testid="voice-call-transcript"');
	expect(markup).toContain('data-testid="voice-call-transcript-toggle"');
	expect(markup).toContain('aria-expanded="true"');
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
	expect(markup).toContain('aria-expanded="false"');
	expect(markup).toContain('role="alert"');
	expect(markup).toContain("Microphone permission is required.");
});

test("renders a borderless text-history accordion when the transcript is hidden", () => {
	const markup = renderToStaticMarkup(
		<VoiceModeCallScreen showTranscript={false} voice={VOICE} />
	);

	expect(markup).toContain("Text history");
	expect(markup).toContain('aria-label="Show text history"');
	expect(markup).toContain('aria-expanded="false"');
	expect(markup).not.toContain('data-testid="voice-call-transcript"');
	expect(markup).not.toContain("border border-border");
});

test("does not repeat connected or listening labels beside the waveform", () => {
	const markup = renderToStaticMarkup(
		<VoiceModeCallScreen
			showTranscript={false}
			voice={{ ...VOICE, phase: "listening", turns: [] }}
		/>
	);

	expect(markup).not.toContain("Connected to");
	expect(markup).not.toContain("Listening");
	expect(markup).not.toContain('role="status"');
});

test("renders the text composer below the call controls when supplied", () => {
	const markup = renderToStaticMarkup(
		<VoiceModeCallScreen
			composer={<div data-testid="text-composer">Type a message</div>}
			showTranscript={false}
			voice={VOICE}
		/>
	);

	expect(markup).toContain('data-testid="voice-call-composer"');
	expect(markup).toContain('data-testid="text-composer"');
	expect(markup.indexOf('data-testid="voice-call-end"')).toBeLessThan(
		markup.indexOf('data-testid="voice-call-composer"')
	);
});
