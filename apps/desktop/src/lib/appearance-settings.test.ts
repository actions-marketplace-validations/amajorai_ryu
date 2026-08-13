import { describe, expect, it } from "bun:test";
import "@/src/lib/appearance-settings.ts";
import { listSettingsByCategory } from "@/src/lib/settings-registry.ts";

/**
 * Guardrail: every Appearance preference must be registered so
 * "Reset to defaults" cannot silently skip new toggles again.
 */
describe("appearance settings registry", () => {
	it("registers the previously missed Appearance toggles", () => {
		const ids = new Set(listSettingsByCategory("appearance").map((e) => e.id));

		for (const id of [
			"appearance.animations-enabled",
			"appearance.stream-animation",
			"appearance.inverted-backgrounds",
			"appearance.sidebar-mode",
			"appearance.sidebar-variant",
			"appearance.group-chats-by-date",
			"appearance.sidebar-overflow-popover",
			"appearance.group-tool-uses",
			"appearance.expand-file-edits",
			"appearance.expand-commands",
			"appearance.pin-user-message",
			"appearance.seasonal-effects",
			"appearance.seasonal-theme",
		]) {
			expect(ids.has(id)).toBe(true);
		}
	});

	it("registers core theme / layout prefs", () => {
		const ids = new Set(listSettingsByCategory("appearance").map((e) => e.id));

		for (const id of [
			"appearance.theme-mode",
			"appearance.light-preset",
			"appearance.dark-preset",
			"appearance.ui-font",
			"appearance.heading-font",
			"appearance.code-font",
			"appearance.contrast",
			"appearance.radius",
			"appearance.spacing",
			"appearance.card-spacing",
			"appearance.chat-width",
			"appearance.sidebar-width",
			"appearance.background-customization",
			"appearance.usage-bar",
			"appearance.diff-view",
			"appearance.file-tree",
			"appearance.timezone",
		]) {
			expect(ids.has(id)).toBe(true);
		}
	});
});
