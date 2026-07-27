// Auto-hide title bar preference — when on, the top chrome (tab strip + page
// actions) slides away until the cursor nears the top edge, same hover-peek
// pattern as the closed floating sidebar. Docked (off) by default.

import { usePersistedToggle } from "@/src/hooks/usePersistedToggle.ts";

export const AUTO_HIDE_TITLEBAR_KEY = "ryu:auto-hide-titlebar";

/** `[enabled, setEnabled]` — synced across TitleBar, Layout, settings, and menus. */
export function useAutoHideTitleBar(): [boolean, (v: boolean) => void] {
	return usePersistedToggle(AUTO_HIDE_TITLEBAR_KEY, false);
}
