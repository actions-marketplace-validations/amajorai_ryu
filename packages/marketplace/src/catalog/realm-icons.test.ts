// The realm→glyph map is the single source of truth shared by the tab nav and
// the card fallback, so they can never drift. Pin that every realm has a glyph
// and the glyphs are distinct (the drift this map exists to prevent — skills
// wearing the plugins puzzle, workflows using a mismatched variant).

import { describe, expect, test } from "bun:test";
import {
	BrainIcon,
	Package01Icon,
	PlugSocketIcon,
	PotionIcon,
	ServerStack01Icon,
	Target01Icon,
	WorkflowCircle06Icon,
} from "@hugeicons/core-free-icons";
import { type CatalogRealm, REALM_ICONS } from "./realm-icons.ts";

const REALMS: CatalogRealm[] = [
	"apps",
	"plugins",
	"models",
	"skills",
	"mcp",
	"agents",
	"workflows",
];

describe("REALM_ICONS", () => {
	test("glyphs are distinct across realms (no accidental reuse)", () => {
		const glyphs = REALMS.map((r) => REALM_ICONS[r]);
		expect(new Set(glyphs).size).toBe(REALMS.length);
	});

	test("matches the sidebar vocabulary for shared catalog realms", () => {
		expect(REALM_ICONS).toEqual({
			apps: Package01Icon,
			plugins: PlugSocketIcon,
			models: BrainIcon,
			skills: PotionIcon,
			mcp: ServerStack01Icon,
			agents: Target01Icon,
			workflows: WorkflowCircle06Icon,
		});
	});
});
