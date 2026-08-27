import { describe, expect, it } from "bun:test";
import {
	DEFAULT_SPEECH_PROCESSING_PREFS,
	parseSpeechProcessingPrefs,
	SPEECH_PROCESSING_ENGINE_VALUES,
} from "./speech-processing.ts";

describe("Speech Processing preference", () => {
	it("uses S1-mini by default", () => {
		expect(parseSpeechProcessingPrefs(null)).toEqual(
			DEFAULT_SPEECH_PROCESSING_PREFS
		);
		expect(SPEECH_PROCESSING_ENGINE_VALUES).toEqual(["s1-mini"]);
	});

	it("preserves valid S1 controls and defaults malformed ones", () => {
		expect(
			parseSpeechProcessingPrefs(
				JSON.stringify({
					context: "email",
					engine: "not-an-engine",
					structure: "lists",
					styling: "formal",
				})
			)
		).toEqual({
			context: "email",
			engine: "s1-mini",
			structure: "lists",
			styling: "formal",
		});
	});
});
