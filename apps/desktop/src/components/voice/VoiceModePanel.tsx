// The transcript-visible voice call presentation. The call shell itself lives
// in VoiceModeCallScreen so the transcript setting changes only the content,
// not the active-call controls or permission/error behavior.

import type { ReactNode } from "react";
import type { VoiceMode } from "@/src/hooks/useVoiceMode.ts";
import { VoiceModeCallScreen } from "./VoiceModeCallScreen.tsx";

export function VoiceModePanel({
	composer,
	voice,
}: {
	composer?: ReactNode;
	voice: VoiceMode;
}) {
	return (
		<VoiceModeCallScreen composer={composer} showTranscript voice={voice} />
	);
}
