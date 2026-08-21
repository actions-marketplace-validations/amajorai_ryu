import { describe, expect, test } from "bun:test";
import type { AgentPersona } from "@/src/lib/api/agents.ts";
import { glyphToPersonaFields, personaToGlyphValue } from "./agent-persona.ts";

describe("agent expressive avatar persona mapping", () => {
	test("maps a saved expressive mood and animation into the shared glyph", () => {
		const persona: AgentPersona = {
			display_name: null,
			expressive: { animation: "orbit", expression: "laughing" },
			tone: null,
		};

		expect(personaToGlyphValue(persona)).toEqual({
			animation: "orbit",
			kind: "expressive",
			expression: "laughing",
		});
	});

	test("serializes expressive glyphs and clears competing sources", () => {
		expect(
			glyphToPersonaFields({
				animation: "burst",
				expression: "happy",
				kind: "expressive",
			})
		).toEqual({
			avatar_url: null,
			dicebear: null,
			dither: null,
			expressive: { animation: "burst", expression: "happy" },
			emoji: null,
			icon: null,
			icon_color: null,
		});
	});
});
