import { describe, expect, it } from "bun:test";
import { DESKTOP_HOTKEYS } from "./actions.ts";

describe("Desktop settings dialog shortcuts", () => {
	const settings = DESKTOP_HOTKEYS.find(
		(action) => action.id === "settings.open"
	);
	const gateway = DESKTOP_HOTKEYS.find(
		(action) => action.id === "gateway.open"
	);

	it("declares distinct platform-aware defaults for both dialogs", () => {
		expect(settings?.label).toBe("Open Settings");
		expect(settings?.category).toBe("General");
		expect(settings?.defaultBinding).toBe("Mod+.");

		expect(gateway?.label).toBe("Open Gateway Settings");
		expect(gateway?.category).toBe("General");
		expect(gateway?.defaultBinding).toBe("Mod+,");

		expect(
			new Set([settings?.defaultBinding, gateway?.defaultBinding]).size
		).toBe(2);
	});
});
