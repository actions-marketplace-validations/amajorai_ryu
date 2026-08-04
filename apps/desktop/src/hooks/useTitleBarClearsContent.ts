// Shared "does the titlebar clear content" predicate.
//
// When the titlebar auto-hides (or fullscreen forces the same treatment), the
// top chrome is not painted and nothing under it needs to reserve room below
// it — panels that normally start below the bar can take the full height. This
// has to stay in lockstep with `effectiveAutoHide` in TitleBar, so it lives in
// one place: Layout's pane clearance, the workspace right/bottom docks, and the
// docked Ask Ryu rail all consume it.

import { useIsMobile } from "@ryu/ui/hooks/use-mobile.ts";
import { useAutoHideTitleBar } from "@/src/hooks/useAutoHideTitleBar.ts";
import { useFullscreen } from "@/src/lib/fullscreen.ts";

/** `true` when the titlebar is shown and occupies the top strip of the window. */
export function useTitleBarClearsContent(): boolean {
	const [autoHideTitleBar] = useAutoHideTitleBar();
	const isFullscreen = useFullscreen();
	const isMobile = useIsMobile();
	return !((autoHideTitleBar || isFullscreen) && !isMobile);
}
