// The pure rules behind the Interface level ladder. Kept separate from the
// browser story (`e2e/interface-level-story.spec.ts`, which covers the slider,
// the fill ramp and the writes) because these are the parts that decide what the
// composer and the node dropdown show, and they regress silently: a level added
// in the middle, or a gate flipped to `!==`, still typechecks and still renders a
// slider.

import { describe, expect, it } from "bun:test";
import {
	collapsesNodeSections,
	DEFAULT_INTERFACE_LEVEL,
	INTERFACE_LEVELS,
	type InterfaceLevel,
	interfaceLevelIndex,
	showsComposerTuning,
	showsModelPicker,
} from "./interface-level.ts";

const IDS = INTERFACE_LEVELS.map((l) => l.id);

describe("the ladder", () => {
	it("defaults to the least surface, which is the first detent", () => {
		expect(DEFAULT_INTERFACE_LEVEL).toBe("simple");
		expect(interfaceLevelIndex(DEFAULT_INTERFACE_LEVEL)).toBe(0);
	});

	it("orders least → most surface", () => {
		expect(IDS).toEqual(["simple", "standard", "advanced", "expert"]);
	});

	it("gives every level a distinct detent", () => {
		const indexes = IDS.map((id) => interfaceLevelIndex(id));
		expect(new Set(indexes).size).toBe(IDS.length);
		expect(Math.max(...indexes)).toBe(IDS.length - 1);
	});

	it("parks an unknown level on the first detent rather than -1", () => {
		// -1 would render a slider with no thumb; the floor is load-bearing.
		expect(interfaceLevelIndex("nonsense" as InterfaceLevel)).toBe(0);
	});
});

describe("what the composer shows", () => {
	it("hides the model picker only at Simple", () => {
		expect(showsModelPicker("simple")).toBe(false);
		expect(showsModelPicker("standard")).toBe(true);
		expect(showsModelPicker("advanced")).toBe(true);
		expect(showsModelPicker("expert")).toBe(true);
	});

	it("shows approval / thinking / style from Advanced up", () => {
		expect(showsComposerTuning("simple")).toBe(false);
		expect(showsComposerTuning("standard")).toBe(false);
		expect(showsComposerTuning("advanced")).toBe(true);
		expect(showsComposerTuning("expert")).toBe(true);
	});

	it("never offers tuning without the model it tunes", () => {
		// Approval mode and thinking budget describe how a MODEL is driven, so a
		// level that surfaced them while hiding the model would read as broken.
		for (const id of IDS) {
			if (showsComposerTuning(id)) {
				expect(showsModelPicker(id)).toBe(true);
			}
		}
	});

	it("only ever adds surface as the level rises", () => {
		const model = IDS.map((id) => showsModelPicker(id));
		const tuning = IDS.map((id) => showsComposerTuning(id));
		for (let i = 1; i < IDS.length; i++) {
			expect(model[i] || !model[i - 1]).toBe(true);
			expect(tuning[i] || !tuning[i - 1]).toBe(true);
		}
	});
});

describe("what the node selector shows", () => {
	// Kept out of the ladder sweep above on purpose: this gate is inverted
	// relative to the composer's — true is LESS surface — so folding it into the
	// "only ever adds surface" loop would need a negation and would read as the
	// opposite of what it asserts.
	it("collapses the technical blocks only at Simple", () => {
		expect(collapsesNodeSections("simple")).toBe(true);
		expect(collapsesNodeSections("standard")).toBe(false);
		expect(collapsesNodeSections("advanced")).toBe(false);
		expect(collapsesNodeSections("expert")).toBe(false);
	});

	it("folds them at the default level, where the disclosure has to work", () => {
		// The a11y hazard this gate carries only exists at a level someone lands on
		// without choosing it; if the default ever moves, the trigger's keyboard
		// story stops being load-bearing and this test should be revisited.
		expect(collapsesNodeSections(DEFAULT_INTERFACE_LEVEL)).toBe(true);
	});
});
