// Thin wrapper: the presentational suggestion chip now lives in
// @ryu/blocks/island. This file adapts the island's richer `IslandSuggestion`
// (id/source/confidence/...) onto the block's structural `{title, body}` view.
//
// Prior art: apps/desktop/src/components/companion/SuggestionChip.tsx.

import { IslandSuggestionChip as IslandSuggestionChipBlock } from "@ryu/blocks/island/suggestion-chip";
import type { IslandSuggestion } from "../../shared/ipc.ts";

export interface IslandSuggestionChipProps {
	suggestion: IslandSuggestion;
	/** Wrap the title/body instead of truncating (the island grows to fit). */
	wrap?: boolean;
}

export function IslandSuggestionChip({
	suggestion,
	wrap,
}: IslandSuggestionChipProps) {
	return (
		<IslandSuggestionChipBlock
			suggestion={{ title: suggestion.title, body: suggestion.body }}
			wrap={wrap}
		/>
	);
}
