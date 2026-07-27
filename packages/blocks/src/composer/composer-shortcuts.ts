import { type Chord, chordMatches, normalizeChord } from "@ryu/hotkeys/chord";
import type { ComposerSettingsSection } from "./composer-settings-menu.tsx";

const NON_CYCLABLE_AGENT_IDS = new Set(["__create_agent__"]);

/** Stable action ids shared with the desktop hotkey registry + Core keybindings. */
export const COMPOSER_SHORTCUT_IDS = [
	"composer.cycle-agent",
	"composer.cycle-mode",
	"composer.cycle-model",
	"composer.cycle-thinking",
] as const;

export type ComposerShortcutId = (typeof COMPOSER_SHORTCUT_IDS)[number];

/** Default chords — focus-scoped (fire only inside the composer input). */
export const COMPOSER_SHORTCUT_DEFAULTS: Record<ComposerShortcutId, Chord> = {
	"composer.cycle-agent": "Tab",
	"composer.cycle-mode": "Shift+Tab",
	"composer.cycle-model": "Shift+M",
	"composer.cycle-thinking": "Shift+T",
};

/** Effective bindings for the four composer cycle actions (`null` = unbound). */
export type ComposerShortcutBindings = Record<ComposerShortcutId, Chord | null>;

export interface ComposerShortcutEvent {
	altKey: boolean;
	ctrlKey: boolean;
	key: string;
	metaKey: boolean;
	nativeEvent?: { isComposing?: boolean };
	preventDefault?: () => void;
	shiftKey: boolean;
}

/** Merge saved overrides with composer defaults (absent key → default). */
export function resolveComposerShortcutBindings(
	overrides: Partial<Record<string, Chord | null>> = {}
): ComposerShortcutBindings {
	const bindings = {} as ComposerShortcutBindings;
	for (const id of COMPOSER_SHORTCUT_IDS) {
		if (Object.hasOwn(overrides, id)) {
			const override = overrides[id];
			bindings[id] = override ? normalizeChord(override) : null;
		} else {
			bindings[id] = normalizeChord(COMPOSER_SHORTCUT_DEFAULTS[id]);
		}
	}
	return bindings;
}

/** Pick the four composer bindings out of a full hotkey id → chord map. */
export function composerBindingsFromMap(
	bindings: ReadonlyMap<string, Chord | null>
): ComposerShortcutBindings {
	const overrides: Partial<Record<string, Chord | null>> = {};
	for (const id of COMPOSER_SHORTCUT_IDS) {
		if (bindings.has(id)) {
			overrides[id] = bindings.get(id) ?? null;
		}
	}
	return resolveComposerShortcutBindings(overrides);
}

function currentIndex(section: ComposerSettingsSection): number {
	const selected = section.value ?? section.items[0]?.id;
	const index = section.items.findIndex((item) => item.id === selected);
	return index >= 0 ? index : 0;
}

function cycleSection(
	section: ComposerSettingsSection | undefined,
	filterItem: (id: string) => boolean = () => true
): boolean {
	if (!section) {
		return false;
	}
	const items = section.items.filter((item) => filterItem(item.id));
	if (items.length < 2) {
		return false;
	}
	const selected = section.value ?? section.items[currentIndex(section)]?.id;
	const selectedIndex = items.findIndex((item) => item.id === selected);
	const nextIndex = selectedIndex >= 0 ? selectedIndex + 1 : 0;
	section.onChange(items[nextIndex % items.length].id);
	return true;
}

function findSection(
	sections: ComposerSettingsSection[],
	predicate: (section: ComposerSettingsSection) => boolean
): ComposerSettingsSection | undefined {
	return sections.find(
		(section) => section.items.length > 0 && predicate(section)
	);
}

function isThinkingSection(section: ComposerSettingsSection): boolean {
	const haystack = `${section.key} ${section.label} ${section.ariaLabel}`
		.toLowerCase()
		.trim();
	return ["thinking", "reasoning", "reason", "thought", "effort"].some((word) =>
		haystack.includes(word)
	);
}

function isApprovalSection(section: ComposerSettingsSection): boolean {
	if (section.key === "approval") {
		return true;
	}
	const haystack = `${section.key} ${section.label} ${section.ariaLabel}`
		.toLowerCase()
		.trim();
	if (section.label.trim().toLowerCase() === "mode") {
		return true;
	}
	return ["approval", "permission", "sandbox", "access"].some((word) =>
		haystack.includes(word)
	);
}

function firstExtraConfigSection(
	sections: ComposerSettingsSection[]
): ComposerSettingsSection | undefined {
	return findSection(
		sections,
		(section) =>
			section.key !== "agent" &&
			section.key !== "model" &&
			!isApprovalSection(section)
	);
}

function runComposerShortcut(
	id: ComposerShortcutId,
	sections: ComposerSettingsSection[]
): boolean {
	switch (id) {
		case "composer.cycle-agent":
			return cycleSection(
				findSection(sections, (section) => section.key === "agent"),
				(itemId) => {
					if (NON_CYCLABLE_AGENT_IDS.has(itemId)) {
						return false;
					}
					return !itemId.startsWith("team:");
				}
			);
		case "composer.cycle-mode":
			return cycleSection(findSection(sections, isApprovalSection));
		case "composer.cycle-model":
			return cycleSection(
				findSection(sections, (section) => section.key === "model")
			);
		case "composer.cycle-thinking":
			return cycleSection(
				findSection(sections, isThinkingSection) ??
					firstExtraConfigSection(sections)
			);
		default:
			return false;
	}
}

/**
 * Cycle agent / mode / model / thinking pickers from a keyboard event.
 * Returns true when handled. Bindings default to Tab / Shift+Tab / Shift+M /
 * Shift+T; pass resolved overrides from Settings → Keyboard shortcuts.
 */
export function handleComposerSettingsShortcut(
	event: ComposerShortcutEvent,
	sections: ComposerSettingsSection[],
	bindings: ComposerShortcutBindings = resolveComposerShortcutBindings()
): boolean {
	if (event.nativeEvent?.isComposing) {
		return false;
	}

	for (const id of COMPOSER_SHORTCUT_IDS) {
		const chord = bindings[id];
		if (!chord) {
			continue;
		}
		if (!chordMatches(chord, event)) {
			continue;
		}
		const handled = runComposerShortcut(id, sections);
		if (handled) {
			event.preventDefault?.();
		}
		return handled;
	}

	return false;
}
