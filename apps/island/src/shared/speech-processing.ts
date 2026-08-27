// Shared preference contract for the node-local Speech Processing layer.
//
// The desktop writes this JSON blob to Core and the Island reads it when a
// dictation recording finishes. Voice Recognition remains a separate engine:
// this layer only cleans the raw transcript after ASR.

/** Preference key shared with the desktop and Core KV store. */
export const SPEECH_PROCESSING_PREF_KEY = "speech-processing";

/** Speech Processing engines currently supported by Core. */
export type SpeechProcessingEngine = "s1-mini";

/** S1-mini's required styling control-line values. */
export type SpeechProcessingStyling =
	| "casual"
	| "semi-casual"
	| "semi-formal"
	| "formal";

/** S1-mini's required structure control-line values. */
export type SpeechProcessingStructure = "prose" | "lists";

/** S1-mini's required destination-context control-line values. */
export type SpeechProcessingContext = "general" | "email";

/** The JSON shape stored under {@link SPEECH_PROCESSING_PREF_KEY}. */
export interface SpeechProcessingPrefs {
	context: SpeechProcessingContext;
	engine: SpeechProcessingEngine;
	structure: SpeechProcessingStructure;
	styling: SpeechProcessingStyling;
}

/** Total engine list used by coercion and future layer additions. */
export const SPEECH_PROCESSING_ENGINE_VALUES: readonly SpeechProcessingEngine[] =
	["s1-mini"];

/** Default node-local cleanup configuration. */
export const DEFAULT_SPEECH_PROCESSING_PREFS: SpeechProcessingPrefs = {
	context: "general",
	engine: "s1-mini",
	structure: "prose",
	styling: "semi-formal",
};

function isSpeechProcessingEngine(
	value: unknown
): value is SpeechProcessingEngine {
	return (
		typeof value === "string" &&
		SPEECH_PROCESSING_ENGINE_VALUES.includes(value as SpeechProcessingEngine)
	);
}

/** Parse a stored Speech Processing preference without trusting its JSON. */
export function parseSpeechProcessingPrefs(
	raw: string | null
): SpeechProcessingPrefs {
	if (!raw) {
		return DEFAULT_SPEECH_PROCESSING_PREFS;
	}
	try {
		const parsed = JSON.parse(raw) as Partial<SpeechProcessingPrefs>;
		return {
			context:
				parsed.context === "email"
					? "email"
					: DEFAULT_SPEECH_PROCESSING_PREFS.context,
			engine: isSpeechProcessingEngine(parsed.engine)
				? parsed.engine
				: DEFAULT_SPEECH_PROCESSING_PREFS.engine,
			structure:
				parsed.structure === "lists"
					? "lists"
					: DEFAULT_SPEECH_PROCESSING_PREFS.structure,
			styling:
				parsed.styling === "casual" ||
				parsed.styling === "semi-casual" ||
				parsed.styling === "formal" ||
				parsed.styling === "semi-formal"
					? parsed.styling
					: DEFAULT_SPEECH_PROCESSING_PREFS.styling,
		};
	} catch {
		return DEFAULT_SPEECH_PROCESSING_PREFS;
	}
}
