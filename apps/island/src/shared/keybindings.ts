// Cross-process contract for the shared `keybindings` Core preference.
// Desktop writes overrides from Settings → Keyboard shortcuts; the island reads
// them so composer cycle chords stay in sync. The blob is a JSON map of action
// id → chord (or null when cleared). Composer defaults live in @ryu/blocks.

/** Preference key shared with the desktop's preferences client + Core KV store. */
export const KEYBINDINGS_PREF_KEY = "keybindings";

/** Saved overrides (action id → chord, or null when cleared). */
export type KeybindingOverrides = Record<string, string | null>;

/** Tolerantly parse a raw Core preference blob into overrides. */
export function parseKeybindingOverrides(
	raw: string | null
): KeybindingOverrides {
	if (!raw) {
		return {};
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as KeybindingOverrides;
		}
	} catch {
		// Corrupt blob: fall back to defaults rather than throwing.
	}
	return {};
}
