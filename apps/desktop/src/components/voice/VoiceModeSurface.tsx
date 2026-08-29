// Chooses whether the compact live voice call includes its running transcript.
// Driven by the "Show transcript in voice mode" desktop setting
// (`ryu:voice-show-transcript`, default ON). One swap-in for every voice mount
// point (ChatPage, EmptyTabsState, composer slot) keeps the choice centralized.

import type { ReactNode } from "react";
import { usePersistedToggle } from "@/src/hooks/usePersistedToggle.ts";
import type { VoiceMode } from "@/src/hooks/useVoiceMode.ts";
import { VOICE_SHOW_TRANSCRIPT_KEY } from "@/src/lib/voice-prefs.ts";
import { VoiceModeCallScreen } from "./VoiceModeCallScreen.tsx";

export function VoiceModeSurface({
	composer,
	voice,
}: {
	composer?: ReactNode;
	voice: VoiceMode;
}) {
	const [showTranscript, setShowTranscript] = usePersistedToggle(
		VOICE_SHOW_TRANSCRIPT_KEY,
		true
	);
	if (!voice.active) {
		return null;
	}
	return (
		<VoiceModeCallScreen
			composer={composer}
			onShowTranscriptChange={setShowTranscript}
			showTranscript={showTranscript}
			voice={voice}
		/>
	);
}
