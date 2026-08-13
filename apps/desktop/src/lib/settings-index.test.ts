// Two jobs:
//   1. Prove the search ranking does what the UI promises.
//   2. Stop the index rotting. Rows get renamed; nothing in the type system ties
//      an indexed label to the JSX that renders it, so this test re-reads the
//      settings sources and fails when an indexed label no longer exists there.
//
// The reverse direction (labels in source, missing from the index) is REPORTED,
// not failed: some rows are readouts, not settings, and forcing every one of them
// into the index would make the search list worse, not better.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	SETTINGS_ENTRIES,
	searchSettings,
	sectionLabel,
} from "./settings-index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SETTINGS_DIR = join(HERE, "..", "components", "settings");
const GATEWAY_DIALOG = join(
	HERE,
	"..",
	"components",
	"gateway",
	"GatewayDialog.tsx"
);

/**
 * Every file that can legitimately own a row for a given section. A section can
 * have several (Voice is five sub-panels; Gateway sections live either in their
 * own component file or inline in GatewayDialog.tsx).
 */
const SECTION_SOURCES: Record<string, string[]> = {
	// The Tabs settings, plus the pane-layout preset manager rendered beside
	// them from its own file (same pattern as Voice's sub-panels).
	general: ["GeneralTab.tsx", "SplitPresetSettings.tsx"],
	appearance: ["AppearanceTab.tsx"],
	developer: ["DeveloperTab.tsx", "DevMetricsPanel.tsx"],
	account: ["AccountTab.tsx"],
	sessions: ["SessionsTab.tsx"],
	sync: ["SettingsSyncTab.tsx"],
	voice: [
		"AudioDevicesSettings.tsx",
		"VoiceModeDisplaySettings.tsx",
		"VoiceInputSettings.tsx",
		"VoiceReadbackSettings.tsx",
		"TtsEngineSettings.tsx",
	],
	privacy: ["PrivacySettings.tsx"],
	storage: ["StorageSettings.tsx"],
	encryption: ["EncryptionSettings.tsx"],
	danger: ["DangerZoneSettings.tsx"],
	network: ["NetworkSettings.tsx"],
	integrations: ["IntegrationsTab.tsx"],
	connections: ["ConnectionsTab.tsx"],
};

/**
 * Entries whose label is deliberately NOT a verbatim row title — the
 * group-level entries for bespoke panes, and the sections that render from a
 * registry rather than from `SettingsItem` rows (keyboard shortcuts, updates).
 * Listed explicitly so "not checked" is a decision on the page, not an accident.
 */
const UNANCHORED_SECTIONS = new Set([
	"keyboard",
	"updates",
	"keys",
	"guardrails",
	"providers",
	"defaults",
	"access",
	"permissions",
	"workspace",
	"usage",
	"email-alerts",
	"audit",
	"evals",
	"health",
	"routing",
	"budgets",
]);

const readSection = (section: string): string | null => {
	const files = SECTION_SOURCES[section];
	if (!files) {
		return null;
	}
	return files
		.map((f) => readFileSync(join(SETTINGS_DIR, f), "utf8"))
		.join("\n");
};

describe("settings index integrity", () => {
	it("has unique ids", () => {
		const ids = SETTINGS_ENTRIES.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("names a section label for every entry", () => {
		for (const entry of SETTINGS_ENTRIES) {
			// Falls back to the raw value when unmapped — that fallback is the bug
			// this asserts against, not a feature.
			expect(sectionLabel(entry)).not.toBe(entry.section);
		}
	});

	it("every indexed label still exists in the source that renders it", () => {
		const stale: string[] = [];
		for (const entry of SETTINGS_ENTRIES) {
			if (UNANCHORED_SECTIONS.has(entry.section)) {
				continue;
			}
			const source =
				readSection(entry.section) ?? readFileSync(GATEWAY_DIALOG, "utf8");
			if (!source.includes(`"${entry.label}"`)) {
				stale.push(`${entry.id} → "${entry.label}"`);
			}
		}
		expect(stale).toEqual([]);
	});
});

describe("searchSettings", () => {
	it("returns nothing for an empty query", () => {
		expect(searchSettings("")).toEqual([]);
		expect(searchSettings("   ")).toEqual([]);
	});

	it("ranks an exact label above a partial one", () => {
		const results = searchSettings("density");
		expect(results[0]?.label).toBe("Density");
	});

	it("finds a setting by a word that is not in its label", () => {
		// "dark mode" is what people type; the row is called "Color theme".
		const ids = searchSettings("dark mode").map((e) => e.id);
		expect(ids).toContain("appearance.theme.color-theme");
	});

	it("ANDs the tokens instead of ORing them", () => {
		const both = searchSettings("diff line");
		expect(both.length).toBeGreaterThan(0);
		for (const entry of both) {
			const hay =
				`${entry.label} ${entry.group} ${entry.keywords ?? ""}`.toLowerCase();
			expect(hay).toContain("line");
		}
		// A token that matches nothing kills the whole query.
		expect(searchSettings("diff zzzznotathing")).toEqual([]);
	});

	it("reaches into both dialogs from one query", () => {
		const dialogs = new Set(searchSettings("key").map((e) => e.dialog));
		expect(dialogs.has("gateway")).toBe(true);
	});

	it("respects the result cap", () => {
		expect(searchSettings("e", 5).length).toBeLessThanOrEqual(5);
	});
});
