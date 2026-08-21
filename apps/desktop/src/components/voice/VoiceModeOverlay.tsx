// The transcript-hidden voice call presentation. It keeps the same compact
// call controls as the default surface while honoring the existing setting.

import type { VoiceMode } from "@/src/hooks/useVoiceMode.ts";
import { VoiceModeCallScreen } from "./VoiceModeCallScreen.tsx";

export function VoiceModeOverlay({ voice }: { voice: VoiceMode }) {
	return <VoiceModeCallScreen showTranscript={false} voice={voice} />;
}
