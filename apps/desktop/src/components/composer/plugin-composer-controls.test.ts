// apps/desktop/src/components/composer/plugin-composer-controls.test.ts
//
// Tests for the composer's app-contributed controls. The load-bearing behaviours:
//   - the ORIGINAL toggle path is unchanged (it is the only shape shipping today,
//     and every one of them must still reach the "+" menu);
//   - each newer type reaches the seam it is documented to render in, honouring
//     `placement` and `order`;
//   - an unknown/malformed control is SKIPPED silently — a composer that throws
//     because an app shipped a control this build predates is the failure mode
//     the open `type` string exists to prevent.

import { describe, expect, test } from "bun:test";
import type { PluginComposerControl } from "@/src/lib/api/plugins.ts";
import {
	composerControlPlacement,
	composerSelectOptions,
	composerSelectValue,
	isKnownComposerControl,
	type KnownComposerControl,
	partitionComposerControls,
	sortComposerControls,
} from "./plugin-composer-controls.ts";

function control(
	over: Partial<PluginComposerControl> = {}
): PluginComposerControl {
	return {
		id: "double-check",
		flag: "io.ryu.double-check",
		label: "Double-check",
		plugin: "io.ryu.double-check",
		type: "toggle",
		...over,
	};
}

describe("validation", () => {
	test("accepts every documented type", () => {
		for (const type of ["toggle", "select", "chip", "action"]) {
			expect(isKnownComposerControl(control({ type }))).toBe(true);
		}
	});

	test("skips a control type this build does not render", () => {
		expect(isKnownComposerControl(control({ type: "hologram" }))).toBe(false);
	});

	test("skips a control missing the fields every type needs", () => {
		// `flag` is the composer's ONLY channel to the turn; `plugin` names the app
		// that owns the control (and whose capability an `action` dispatches).
		expect(isKnownComposerControl(control({ flag: "" }))).toBe(false);
		expect(isKnownComposerControl(control({ plugin: "" }))).toBe(false);
		expect(isKnownComposerControl(control({ id: "" }))).toBe(false);
		expect(isKnownComposerControl(control({ label: "" }))).toBe(false);
	});
});

describe("placement", () => {
	test("an explicit placement wins", () => {
		expect(
			composerControlPlacement(
				control({ type: "chip", placement: "menu" }) as KnownComposerControl
			)
		).toBe("menu");
		expect(
			composerControlPlacement(
				control({ type: "select", placement: "bar" }) as KnownComposerControl
			)
		).toBe("bar");
	});

	test("chips and actions default to the composer bar, selects to the menu", () => {
		expect(
			composerControlPlacement(
				control({ type: "chip" }) as KnownComposerControl
			)
		).toBe("bar");
		expect(
			composerControlPlacement(
				control({ type: "action" }) as KnownComposerControl
			)
		).toBe("bar");
		expect(
			composerControlPlacement(
				control({ type: "select" }) as KnownComposerControl
			)
		).toBe("menu");
	});
});

describe("partitionComposerControls", () => {
	test("the existing toggle path is untouched", () => {
		const { toggles, selects, bar } = partitionComposerControls([control()]);
		expect(toggles.map((c) => c.flag)).toEqual(["io.ryu.double-check"]);
		expect(selects).toHaveLength(0);
		expect(bar).toHaveLength(0);
	});

	test("a toggle always reaches the + menu, whatever its placement says", () => {
		// The shared "+" button is the only seam offering toggle rows; a bar-placed
		// toggle must not vanish because of it.
		const { toggles, bar } = partitionComposerControls([
			control({ placement: "bar" }),
		]);
		expect(toggles).toHaveLength(1);
		expect(bar).toHaveLength(0);
	});

	test("each newer type reaches its seam", () => {
		const { toggles, selects, bar } = partitionComposerControls([
			control({ id: "t", type: "toggle" }),
			control({ id: "s", type: "select", flag: "mode" }),
			control({ id: "sb", type: "select", flag: "mode2", placement: "bar" }),
			control({ id: "c", type: "chip", flag: "clip" }),
			control({ id: "a", type: "action", flag: "shot" }),
		]);
		expect(toggles.map((c) => c.id)).toEqual(["t"]);
		expect(selects.map((c) => c.id)).toEqual(["s"]);
		expect(bar.map((c) => c.id).sort()).toEqual(["a", "c", "sb"]);
	});

	test("unknown and malformed entries are dropped, never rendered", () => {
		const { toggles, selects, bar } = partitionComposerControls([
			control({ id: "x", type: "hologram" }),
			control({ id: "y", type: "select", flag: "" }),
		]);
		expect(toggles).toHaveLength(0);
		expect(selects).toHaveLength(0);
		expect(bar).toHaveLength(0);
	});

	test("order wins over label, and both are deterministic", () => {
		const { toggles } = partitionComposerControls([
			control({ id: "b", label: "Beta" }),
			control({ id: "a", label: "Alpha" }),
			control({ id: "z", label: "Zulu", order: 1 }),
		]);
		expect(toggles.map((c) => c.label)).toEqual(["Zulu", "Alpha", "Beta"]);
	});

	test("sorting never mutates the query-cached contributions array", () => {
		const list = [
			{ id: "b", label: "B" },
			{ id: "a", label: "A" },
		];
		sortComposerControls(list);
		expect(list.map((c) => c.id)).toEqual(["b", "a"]);
	});
});

describe("select values", () => {
	const select = control({
		type: "select",
		flag: "mode",
		default: "thorough",
		options: [
			{ value: "fast", label: "Fast" },
			{ value: "thorough", label: "Thorough" },
			// Malformed: unpickable / unreadable, so it is dropped.
			{ value: "", label: "Broken" },
		],
	}) as KnownComposerControl;

	test("drops unusable options", () => {
		expect(composerSelectOptions(select).map((o) => o.value)).toEqual([
			"fast",
			"thorough",
		]);
	});

	test("falls back to the manifest default until the user picks", () => {
		expect(composerSelectValue(select, {})).toBe("thorough");
		expect(composerSelectValue(select, { mode: "fast" })).toBe("fast");
	});

	test("ignores a stale value the control no longer offers", () => {
		expect(composerSelectValue(select, { mode: "gone" })).toBe("thorough");
	});

	test("falls back to the first option when there is no default", () => {
		const noDefault = control({
			type: "select",
			flag: "mode",
			options: [
				{ value: "fast", label: "Fast" },
				{ value: "thorough", label: "Thorough" },
			],
		}) as KnownComposerControl;
		expect(composerSelectValue(noDefault, {})).toBe("fast");
	});

	test("an options-less select has no value to render", () => {
		const empty = control({
			type: "select",
			flag: "mode",
		}) as KnownComposerControl;
		expect(composerSelectValue(empty, {})).toBeUndefined();
	});
});
