import { usePersistedToggle } from "@/src/hooks/usePersistedToggle.ts";

export const NODE_SELECTOR_DETAIL_KEY = "ryu:node-selector-detail";
export const DEFAULT_NODE_SELECTOR_DETAIL = true;

export function useNodeSelectorDetail(): [boolean, (value: boolean) => void] {
	return usePersistedToggle(
		NODE_SELECTOR_DETAIL_KEY,
		DEFAULT_NODE_SELECTOR_DETAIL
	);
}
