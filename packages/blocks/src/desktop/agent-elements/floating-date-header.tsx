// packages/blocks/src/desktop/agent-elements/floating-date-header.tsx
//
// The sticky date chip that names the day you are currently reading, the way
// WhatsApp and Telegram do.

import { Marker, MarkerContent } from "@ryu/ui/components/marker";
import { useMessageScrollerVisibility } from "@ryu/ui/components/message-scroller";
import { memo } from "react";
import { type DayGroup, dayKeyAtTurnIndex, dayLabel } from "./date-groups.ts";

/**
 * OUT OF FLOW BY CONSTRUCTION — this is the whole design.
 *
 * Mounted as a direct child of the MessageScroller ROOT (which is `relative`),
 * a sibling of the viewport, exactly where `ChatToc` lives. `absolute` +
 * `pointer-events-none` means it occupies no space and intercepts no input, so
 * it CANNOT move a scroll anchor.
 *
 * That is not a nicety. The pinned-user-message bar next door sits IN FLOW, and
 * mounting it pushes every anchor below it down — which is why
 * use-pinned-user-message.ts needs `PIN_RELEASE_SLACK` hysteresis and a
 * RAF-deferred first measurement, the fix for the React #185 update loop. A
 * second in-flow element whose visibility is driven by scroll position would
 * reintroduce exactly that loop. Keep this absolute.
 *
 * The state comes from `useMessageScrollerVisibility`, a snapshot the scroller
 * already computes and `ChatToc` already subscribes to on every non-compact
 * transcript. This is a SECOND CONSUMER of an existing RAF-batched store: no
 * new observer, no new effect, no setState-in-effect, no layout reads of our
 * own.
 *
 * Known imprecision, shipped deliberately: the scroller's
 * `scrollPreviousItemPeek` defaults to 64 and message-list passes neither it
 * nor `scrollMargin`, so the anchor — and therefore this chip — flips ~64px
 * BEFORE the separator reaches the top edge.
 */
export const FloatingDateHeader = memo(function FloatingDateHeader({
	groups,
	startOfToday,
	turnIndexByAnchorId,
}: {
	/** Day runs for the transcript, in turn order. */
	groups: readonly DayGroup[];
	/** Midnight today in the display zone; recomputed when the zone changes. */
	startOfToday: number;
	/** Anchor id (the turn's user-message id) → its flat turn index. */
	turnIndexByAnchorId: ReadonlyMap<string, number>;
}) {
	const { currentAnchorId } = useMessageScrollerVisibility();

	// Nothing anchored yet (empty transcript, or a scroll position above the
	// first anchor) — say nothing rather than guess a date.
	if (!currentAnchorId) {
		return null;
	}
	const turnIndex = turnIndexByAnchorId.get(currentAnchorId);
	if (turnIndex === undefined) {
		return null;
	}
	// Resolved by CONTAINMENT, not by the anchor's own turn: only turns with a
	// user message are anchors (`scrollAnchor={Boolean(turn.userMsg)}`), so a
	// group that opens with an assistant-only turn is entered while the current
	// anchor still names a turn in the PREVIOUS group.
	const dayKey = dayKeyAtTurnIndex(groups, turnIndex);
	if (dayKey === null) {
		return null;
	}

	return (
		// The chip sits BELOW the pinned-user-message bar, offset by that bar's
		// measured height (`--chat-pin-bar-h`, published by message-list; `0px`
		// when no bar is mounted, which is also the fallback here). It used to own
		// the 36px lane ABOVE the bar, which put it in the topmost band of the
		// transcript where it overlapped the tab bar and read as window chrome
		// rather than as a marker inside the conversation.
		<div
			// The in-flow separator already announces the date to assistive tech;
			// this is the visual echo of it, so it is hidden from the a11y tree.
			aria-hidden="true"
			className="pointer-events-none absolute inset-x-0 top-[calc(var(--chat-pin-bar-h,0px)+0.375rem)] z-30 flex justify-center"
			data-slot="chat-floating-date"
		>
			{/* The ONE place the transcript still draws a pill, and the reason is
			    specific: this copy overlays live transcript text, so it needs an
			    opaque, blurred backing to stay legible. The in-flow separator sits
			    on the same background and reads better as hairlines, so it is a
			    plain `Marker variant="separator"` (date-separator.tsx). Same
			    primitive, same `dayLabel()`, different surface — only the styling
			    diverges, and it diverges because one floats. */}
			<Marker
				className="min-h-0 w-auto select-none rounded-full border border-border/60 bg-background/80 px-2.5 py-0.5 font-medium text-[11px] backdrop-blur-sm"
				data-slot="chat-date-chip"
			>
				<MarkerContent>{dayLabel(dayKey, startOfToday)}</MarkerContent>
			</Marker>
		</div>
	);
});
