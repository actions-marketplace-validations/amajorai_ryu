// apps/desktop/src/live/adapters/meetings.ts
//
// Built-in live-activity adapter for MEETING RECORDING — the "recording" card.
// Reads the existing `useMeetingRecordingStore` (fed by `useMeetingStream`,
// mounted app-wide) and publishes a single card while ≥1 meeting is recording.
// When nothing records, the card is removed.

import { useEffect } from "react";
import { useLiveActivityStore } from "@/src/store/useLiveActivityStore.ts";
import { useMeetingRecordingStore } from "@/src/store/useMeetingRecordingStore.ts";

const MEETING_ID = "meeting:recording";

export function useMeetingLiveActivities(): void {
	const active = useMeetingRecordingStore((s) => s.active);

	useEffect(() => {
		const store = useLiveActivityStore.getState();
		if (active) {
			store.upsert({
				id: MEETING_ID,
				appId: "shell",
				kind: "meeting",
				title: "Recording meeting",
				detail: "Capturing notes in the background",
				status: "running",
				icon: "mic-02",
				startedAt: Date.now(),
				updatedAt: Date.now(),
				action: { kind: "route", path: "/meetings" },
			});
		} else {
			store.remove(MEETING_ID);
		}
	}, [active]);
}
