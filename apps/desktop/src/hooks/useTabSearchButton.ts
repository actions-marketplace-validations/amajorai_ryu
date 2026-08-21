import { usePersistedToggle } from "@/src/hooks/usePersistedToggle.ts";

export const TAB_SEARCH_BUTTON_KEY = "ryu:tab-search-button";
export const DEFAULT_TAB_SEARCH_BUTTON = true;

export function useTabSearchButton(): [boolean, (value: boolean) => void] {
	return usePersistedToggle(TAB_SEARCH_BUTTON_KEY, DEFAULT_TAB_SEARCH_BUTTON);
}
