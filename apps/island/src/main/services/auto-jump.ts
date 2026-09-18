// Main-process client for Core's shared island-auto-jump preference.
//
// Mirrors `services/edge-offset.ts`: the desktop writes the auto-jump flag under
// the `island-auto-jump` preference key, and this service reads it (on startup)
// and subscribes to Core's SSE change stream so toggling it in settings starts or
// stops the follow-the-cursor behavior live. The value stays an opaque string
// here; `shared/auto-jump.ts` owns the parsing.

import { AUTO_JUMP_PREF_KEY } from "../../shared/auto-jump.ts";
import { subscribePreferenceChanges } from "./preference-stream.ts";
import { getPreferenceRaw } from "./preferences.ts";

/** Read the current auto-jump value (raw), or `null` if unset/unreachable. */
export async function getAutoJumpRaw(): Promise<string | null> {
	return getPreferenceRaw(AUTO_JUMP_PREF_KEY);
}

export function subscribeAutoJumpChanges(
	onValue: (value: string) => void
): () => void {
	return subscribePreferenceChanges(AUTO_JUMP_PREF_KEY, onValue);
}
