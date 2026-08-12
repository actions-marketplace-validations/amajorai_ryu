// Attach-a-ref hook that completes a settings-search jump.
//
// A search result click stores the target in `settings-focus` and switches the
// dialog's section. This hook runs in the content pane: on every section change
// it claims a pending reveal for that section and waits for the row to mount
// before scrolling to and flashing it.

import { type RefObject, useEffect, useRef } from "react";
import {
	consumeSettingReveal,
	revealSettingWhenReady,
} from "@/src/lib/settings-focus.ts";

/**
 * Returns a ref to put on the settings content container. Scoping the search to
 * that container (rather than `document`) keeps a row title in the SIDEBAR from
 * winning over the identically-named row in the pane.
 */
export function useSettingReveal(
	section: string
): RefObject<HTMLDivElement | null> {
	const ref = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const entry = consumeSettingReveal(section);
		if (!entry) {
			return;
		}
		return revealSettingWhenReady(entry, ref.current ?? document);
	}, [section]);
	return ref;
}
