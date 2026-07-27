// Appearance settings registry entries.
//
// Import this module once from AppearanceTab (or app boot) so every appearance
// preference is registered before "Reset to defaults" runs. Adding a new
// Appearance control: give it a module-level setter (or use setPersistedToggle),
// then `registerSetting` here — do not extend a hardcoded reset checklist.
//
// Theme mode (next-themes) needs a React setter; call
// `bindAppearanceThemeMode(setTheme)` from AppearanceTab so reset can update it.

import { resetBackgroundCustomization } from "@/src/hooks/useBackgroundCustomization.ts";
import {
	DEFAULT_CHAT_DATE_GROUPING,
	setChatDateGrouping,
} from "@/src/hooks/useChatDateGrouping.ts";
import { setChromeShadows } from "@/src/hooks/useChromeShadows.ts";
import { setDialogOverlayBlur } from "@/src/hooks/useDialogOverlayBlur.ts";
import { resetDiffViewPrefs } from "@/src/hooks/useDiffViewPrefs.ts";
import { resetFileTreePrefs } from "@/src/hooks/useFileTreePrefs.ts";
import {
	DEFAULT_FRIENDLY_MODE,
	setFriendlyMode,
} from "@/src/hooks/useFriendlyMode.ts";
import { setInvertedBackgrounds } from "@/src/hooks/useInvertedBackgrounds.ts";
import { setPersistedToggle } from "@/src/hooks/usePersistedToggle.ts";
import { setPointerCursor } from "@/src/hooks/usePointerCursor.ts";
import {
	DEFAULT_SIDEBAR_MODE,
	setSidebarMode,
} from "@/src/hooks/useSidebarMode.ts";
import {
	DEFAULT_SIDEBAR_VARIANT,
	setSidebarVariant,
} from "@/src/hooks/useSidebarVariant.ts";
import {
	CODE_FONTS,
	DEFAULT_CHAT_WIDTH,
	DEFAULT_RADIUS,
	DEFAULT_SIDEBAR_WIDTH,
	DEFAULT_SPACING,
	HEADING_FONTS,
	resetCardSpacing,
	setChatWidth,
	setCodeFont,
	setContrast,
	setDarkPreset,
	setHeadingFont,
	setLightPreset,
	setRadius,
	setSidebarWidthSetting,
	setSpacing,
	setUiFont,
	UI_FONTS,
} from "@/src/hooks/useThemePreset.ts";
import { resetUsageBarPrefs } from "@/src/hooks/useUsageBarPrefs.ts";
import { registerSetting, resetCategory } from "@/src/lib/settings-registry.ts";
import { DEFAULT_DARK_ID, DEFAULT_LIGHT_ID } from "@/src/lib/themes/presets.ts";

/** localStorage / toggle keys owned by Appearance. Use these in the tab too. */
export const APPEARANCE_KEYS = {
	sidebarOverflowPopover: "ryu:sidebar-overflow-popover",
	groupToolUses: "ryu:group-tool-uses",
	expandFileEdits: "ryu:expand-file-edits",
	expandCommands: "ryu:expand-commands",
	pinUserMessage: "ryu:pin-user-message",
	animationsEnabled: "ryu:animations-enabled",
	streamAnimation: "ryu:stream-animation",
} as const;

/** Defaults for Appearance toggles / presets (local UI sync after reset). */
export const APPEARANCE_DEFAULTS = {
	themeMode: "system",
	lightPreset: DEFAULT_LIGHT_ID,
	darkPreset: DEFAULT_DARK_ID,
	uiFont: UI_FONTS[0].value,
	headingFont: HEADING_FONTS[0].value,
	codeFont: CODE_FONTS[0].value,
	contrast: 50,
	radius: DEFAULT_RADIUS,
	spacing: DEFAULT_SPACING,
	chatWidth: DEFAULT_CHAT_WIDTH,
	sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
	friendlyNames: DEFAULT_FRIENDLY_MODE,
	pointerCursor: false,
	chromeShadows: true,
	dialogOverlayBlur: false,
	invertedBackgrounds: false,
	sidebarMode: DEFAULT_SIDEBAR_MODE,
	sidebarVariant: DEFAULT_SIDEBAR_VARIANT,
	groupChatsByDate: DEFAULT_CHAT_DATE_GROUPING,
	sidebarOverflowPopover: false,
	groupToolUses: true,
	expandFileEdits: false,
	expandCommands: false,
	pinUserMessage: true,
	animationsEnabled: true,
	streamAnimation: true,
} as const;

type ThemeModeSetter = ((mode: string) => void) | null;

let themeModeSetter: ThemeModeSetter = null;

/**
 * Bind next-themes' `setTheme` so appearance reset can update React state.
 * Call from AppearanceTab; pass `null` on unmount.
 */
export function bindAppearanceThemeMode(setter: ThemeModeSetter): void {
	themeModeSetter = setter;
}

function registerAppearanceSettings(): void {
	registerSetting({
		id: "appearance.theme-mode",
		category: "appearance",
		label: "Theme mode",
		reset: () => {
			try {
				localStorage.setItem("theme", APPEARANCE_DEFAULTS.themeMode);
			} catch {
				// best-effort
			}
			themeModeSetter?.(APPEARANCE_DEFAULTS.themeMode);
		},
	});

	registerSetting({
		id: "appearance.light-preset",
		category: "appearance",
		label: "Light theme preset",
		reset: () => setLightPreset(APPEARANCE_DEFAULTS.lightPreset),
	});

	registerSetting({
		id: "appearance.dark-preset",
		category: "appearance",
		label: "Dark theme preset",
		reset: () => setDarkPreset(APPEARANCE_DEFAULTS.darkPreset),
	});

	registerSetting({
		id: "appearance.ui-font",
		category: "appearance",
		label: "UI font",
		reset: () => setUiFont(APPEARANCE_DEFAULTS.uiFont),
	});

	registerSetting({
		id: "appearance.heading-font",
		category: "appearance",
		label: "Heading font",
		reset: () => setHeadingFont(APPEARANCE_DEFAULTS.headingFont),
	});

	registerSetting({
		id: "appearance.code-font",
		category: "appearance",
		label: "Code font",
		reset: () => setCodeFont(APPEARANCE_DEFAULTS.codeFont),
	});

	registerSetting({
		id: "appearance.contrast",
		category: "appearance",
		label: "Contrast",
		reset: () => setContrast(APPEARANCE_DEFAULTS.contrast),
	});

	registerSetting({
		id: "appearance.radius",
		category: "appearance",
		label: "Corner radius",
		reset: () => setRadius(APPEARANCE_DEFAULTS.radius),
	});

	registerSetting({
		id: "appearance.spacing",
		category: "appearance",
		label: "Spacing",
		reset: () => setSpacing(APPEARANCE_DEFAULTS.spacing),
	});

	registerSetting({
		id: "appearance.card-spacing",
		category: "appearance",
		label: "Card spacing",
		reset: () => resetCardSpacing(),
	});

	registerSetting({
		id: "appearance.chat-width",
		category: "appearance",
		label: "Chat width",
		reset: () => setChatWidth(APPEARANCE_DEFAULTS.chatWidth),
	});

	registerSetting({
		id: "appearance.sidebar-width",
		category: "appearance",
		label: "Sidebar width",
		reset: () => setSidebarWidthSetting(APPEARANCE_DEFAULTS.sidebarWidth),
	});

	registerSetting({
		id: "appearance.friendly-names",
		category: "appearance",
		label: "Friendly names",
		reset: () => setFriendlyMode(APPEARANCE_DEFAULTS.friendlyNames),
	});

	registerSetting({
		id: "appearance.pointer-cursor",
		category: "appearance",
		label: "Pointer cursor",
		reset: () => setPointerCursor(APPEARANCE_DEFAULTS.pointerCursor),
	});

	registerSetting({
		id: "appearance.chrome-shadows",
		category: "appearance",
		label: "Chrome shadows",
		reset: () => setChromeShadows(APPEARANCE_DEFAULTS.chromeShadows),
	});

	registerSetting({
		id: "appearance.dialog-overlay-blur",
		category: "appearance",
		label: "Dialog overlay blur",
		reset: () => setDialogOverlayBlur(APPEARANCE_DEFAULTS.dialogOverlayBlur),
	});

	registerSetting({
		id: "appearance.inverted-backgrounds",
		category: "appearance",
		label: "Inverted backgrounds",
		reset: () =>
			setInvertedBackgrounds(APPEARANCE_DEFAULTS.invertedBackgrounds),
	});

	registerSetting({
		id: "appearance.sidebar-mode",
		category: "appearance",
		label: "Sidebar mode",
		reset: () => setSidebarMode(APPEARANCE_DEFAULTS.sidebarMode),
	});

	registerSetting({
		id: "appearance.sidebar-variant",
		category: "appearance",
		label: "Sidebar variant",
		reset: () => setSidebarVariant(APPEARANCE_DEFAULTS.sidebarVariant),
	});

	registerSetting({
		id: "appearance.group-chats-by-date",
		category: "appearance",
		label: "Group chats by date",
		reset: () => setChatDateGrouping(APPEARANCE_DEFAULTS.groupChatsByDate),
	});

	registerSetting({
		id: "appearance.sidebar-overflow-popover",
		category: "appearance",
		label: "Sidebar overflow popover",
		reset: () =>
			setPersistedToggle(
				APPEARANCE_KEYS.sidebarOverflowPopover,
				APPEARANCE_DEFAULTS.sidebarOverflowPopover
			),
	});

	registerSetting({
		id: "appearance.group-tool-uses",
		category: "appearance",
		label: "Group tool uses",
		reset: () =>
			setPersistedToggle(
				APPEARANCE_KEYS.groupToolUses,
				APPEARANCE_DEFAULTS.groupToolUses
			),
	});

	registerSetting({
		id: "appearance.expand-file-edits",
		category: "appearance",
		label: "Expand file edits",
		reset: () =>
			setPersistedToggle(
				APPEARANCE_KEYS.expandFileEdits,
				APPEARANCE_DEFAULTS.expandFileEdits
			),
	});

	registerSetting({
		id: "appearance.expand-commands",
		category: "appearance",
		label: "Expand commands",
		reset: () =>
			setPersistedToggle(
				APPEARANCE_KEYS.expandCommands,
				APPEARANCE_DEFAULTS.expandCommands
			),
	});

	registerSetting({
		id: "appearance.pin-user-message",
		category: "appearance",
		label: "Pin user message",
		reset: () =>
			setPersistedToggle(
				APPEARANCE_KEYS.pinUserMessage,
				APPEARANCE_DEFAULTS.pinUserMessage
			),
	});

	registerSetting({
		id: "appearance.animations-enabled",
		category: "appearance",
		label: "Animations",
		reset: () =>
			setPersistedToggle(
				APPEARANCE_KEYS.animationsEnabled,
				APPEARANCE_DEFAULTS.animationsEnabled
			),
	});

	registerSetting({
		id: "appearance.stream-animation",
		category: "appearance",
		label: "Stream animation",
		reset: () =>
			setPersistedToggle(
				APPEARANCE_KEYS.streamAnimation,
				APPEARANCE_DEFAULTS.streamAnimation
			),
	});

	registerSetting({
		id: "appearance.background-customization",
		category: "appearance",
		label: "Background customization",
		reset: () => resetBackgroundCustomization(),
	});

	registerSetting({
		id: "appearance.usage-bar",
		category: "appearance",
		label: "Usage bar",
		reset: () => resetUsageBarPrefs(),
	});

	registerSetting({
		id: "appearance.diff-view",
		category: "appearance",
		label: "Diff view",
		reset: () => resetDiffViewPrefs(),
	});

	registerSetting({
		id: "appearance.file-tree",
		category: "appearance",
		label: "File tree",
		reset: () => resetFileTreePrefs(),
	});
}

registerAppearanceSettings();

/** Reset every registered appearance setting to its default. */
export function resetAppearanceSettings(): void {
	resetCategory("appearance");
}
