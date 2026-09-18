// Main-process client for Core's shared island-edge-offset preference.
//
// Mirrors `services/voice.ts` + `services/appearance.ts`: the desktop writes the
// edge offset under the `island-edge-offset` preference key, and this service
// reads it (on startup) and subscribes to Core's SSE change stream so a settings
// change re-docks the island at the new gap live. The value stays an opaque
// string here; `shared/edge-offset.ts` owns the parsing.

import { EDGE_OFFSET_PREF_KEY } from "../../shared/edge-offset.ts";
import { subscribePreferenceChanges } from "./preference-stream.ts";
import { getPreferenceRaw } from "./preferences.ts";

/** Read the current edge offset (raw value), or `null` if unset/unreachable. */
export async function getEdgeOffsetRaw(): Promise<string | null> {
	return getPreferenceRaw(EDGE_OFFSET_PREF_KEY);
}

export function subscribeEdgeOffsetChanges(
	onValue: (value: string) => void
): () => void {
	return subscribePreferenceChanges(EDGE_OFFSET_PREF_KEY, onValue);
}
