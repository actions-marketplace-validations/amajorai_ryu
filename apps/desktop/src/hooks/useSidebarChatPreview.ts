import { usePersistedToggle } from "@/src/hooks/usePersistedToggle.ts";

/** Appearance preference for the two-line latest-activity chat rows. */
export const SIDEBAR_CHAT_PREVIEW_KEY = "ryu:sidebar-chat-preview";
export const DEFAULT_SIDEBAR_CHAT_PREVIEW = false;

export function useSidebarChatPreview(): [boolean, (value: boolean) => void] {
	return usePersistedToggle(
		SIDEBAR_CHAT_PREVIEW_KEY,
		DEFAULT_SIDEBAR_CHAT_PREVIEW
	);
}
