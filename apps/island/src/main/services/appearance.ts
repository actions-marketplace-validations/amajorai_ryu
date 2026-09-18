// Main-process client for Core's shared island-appearance preference.
//
// Mirrors `services/theme.ts`: the desktop writes the appearance blob under the
// `island-appearance` preference key, and this service reads it (on startup) and
// subscribes to Core's SSE change stream so a settings change flips the island's
// window mode live. The blob stays an opaque JSON string here; `shared/appearance.ts`
// owns the parsing.

import { APPEARANCE_PREF_KEY } from "../../shared/appearance.ts";
import { subscribePreferenceChanges } from "./preference-stream.ts";
import { getPreferenceRaw } from "./preferences.ts";

/** Read the current appearance blob (raw JSON), or `null` if unset/unreachable. */
export async function getAppearanceRaw(): Promise<string | null> {
	return getPreferenceRaw(APPEARANCE_PREF_KEY);
}

export function subscribeAppearanceChanges(
	onValue: (value: string) => void
): () => void {
	return subscribePreferenceChanges(APPEARANCE_PREF_KEY, onValue);
}
