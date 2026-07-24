import { useIsMobile } from "@ryu/ui/hooks/use-mobile.ts";
import { useEffect, useState } from "react";

/** Tab layout preference: the horizontal title-bar strip (default) or a vertical
    list in the left sidebar (Zen-browser style). Window-local + reactive across
    the TitleBar, sidebar, settings, and context menus via the same
    localStorage + `storage`-event pattern as the other desktop UI prefs. */
export type TabLayout = "horizontal" | "vertical";

const KEY = "ryu_tab_layout";

function read(): TabLayout {
	return localStorage.getItem(KEY) === "vertical" ? "vertical" : "horizontal";
}

export function useTabLayout(): TabLayout {
	const [layout, setLayout] = useState<TabLayout>(read);
	// At phone widths the sidebar is a Sheet, so a vertical strip living inside
	// it would put the open tabs behind an overlay. Force horizontal there — the
	// stored preference is untouched and comes back on a wide viewport.
	const isMobile = useIsMobile();

	useEffect(() => {
		const handler = () => setLayout(read());
		window.addEventListener("storage", handler);
		return () => window.removeEventListener("storage", handler);
	}, []);

	return isMobile ? "horizontal" : layout;
}

export function setTabLayout(layout: TabLayout) {
	localStorage.setItem(KEY, layout);
	// Same-document listeners don't get the native `storage` event, so broadcast
	// one ourselves — every useTabLayout() consumer re-reads on this.
	window.dispatchEvent(new Event("storage"));
}
