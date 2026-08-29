// The transcript-hidden voice call presentation. It keeps the same compact
// call controls as the default surface while honoring the existing setting.

import type { ReactNode } from "react";
import type { VoiceMode } from "@/src/hooks/useVoiceMode.ts";
import { VoiceModeCallScreen } from "./VoiceModeCallScreen.tsx";

export function VoiceModeOverlay({
	composer,
	voice,
}: {
	composer?: ReactNode;
	voice: VoiceMode;
}) {
	return (
		<VoiceModeCallScreen
			composer={composer}
			showTranscript={false}
			voice={voice}
		/>
	);
}
