// Which sub-page a pending settings-search hit lives in.
//
// A pane built out of `SettingsSubpages` only mounts one page at a time, so a
// search result naming a row on a closed page would be revealed against a DOM
// that does not contain it — `revealSettingWhenReady` polls for two seconds and
// then silently gives up, leaving the user on the right section with nothing
// highlighted. This hook is how the pane learns to open that page first.
//
// It PEEKS rather than consumes: the content pane still claims the one-shot
// request and does the scroll + flash. A subscription rather than a plain read
// because the hit may name a row in the section the user is already on, which
// changes no state the pane would otherwise re-render for.

import { useEffect, useState } from "react";
import {
	peekSettingReveal,
	subscribeSettingReveal,
} from "@/src/lib/settings-focus.ts";
import { subpageFor } from "@/src/lib/settings-index.ts";

/**
 * The sub-page id a pending reveal for `section` targets, or null.
 *
 * Pass the result straight to `SettingsSubpages`' `revealPageId`. It stays set
 * after the reveal completes, which is correct: the value only means "the last
 * search sent you here", and the component acts on changes to it.
 */
export function usePendingSubpage(section: string): string | null {
	const [id, setId] = useState<string | null>(() => {
		const entry = peekSettingReveal(section);
		return entry ? subpageFor(entry) : null;
	});

	useEffect(() => {
		// Re-peek on mount as well as subscribing: the request is normally made a
		// beat BEFORE this pane mounts (the click switches sections), so a
		// subscription alone would miss the one that brought the user here.
		const entry = peekSettingReveal(section);
		if (entry) {
			setId(subpageFor(entry));
		}
		return subscribeSettingReveal((next) => {
			if (next.section === section) {
				setId(subpageFor(next));
			}
		});
	}, [section]);

	return id;
}
