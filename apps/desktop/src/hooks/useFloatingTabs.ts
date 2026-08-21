// Horizontal tab chrome preference. Floating pills are the shipped default;
// turning them off lets the active tab become the page-colored edge of the
// content surface, inspired by beUI's Morphing Tabs block.

import { usePersistedToggle } from "@/src/hooks/usePersistedToggle.ts";

export const FLOATING_TABS_KEY = "ryu:floating-tabs";
export const DEFAULT_FLOATING_TABS = true;

/** `[enabled, setEnabled]` — synced across the titlebar and General settings. */
export function useFloatingTabs(): [boolean, (value: boolean) => void] {
	return usePersistedToggle(FLOATING_TABS_KEY, DEFAULT_FLOATING_TABS);
}
