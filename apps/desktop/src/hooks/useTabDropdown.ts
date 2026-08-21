import { usePersistedToggle } from "@/src/hooks/usePersistedToggle.ts";

/** Whether the title-bar tabs collapse into the searchable tab dropdown. */
export const TAB_DROPDOWN_KEY = "ryu:tab-dropdown";
export const DEFAULT_TAB_DROPDOWN = true;

export function useTabDropdown(): [boolean, (value: boolean) => void] {
	return usePersistedToggle(TAB_DROPDOWN_KEY, DEFAULT_TAB_DROPDOWN);
}
