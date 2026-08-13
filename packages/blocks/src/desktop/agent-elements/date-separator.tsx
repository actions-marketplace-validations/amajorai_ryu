// packages/blocks/src/desktop/agent-elements/date-separator.tsx
//
// The centred "Today" / "Yesterday" / "12 March 2026" row that opens each day in
// the transcript.
//
// It is a `Marker` (`@ryu/ui/components/marker`, `variant="separator"`), which is
// THE single inline-state row style in the transcript — day boundaries,
// interrupted turns, threshold failover and history notices all draw as one. The
// pill that used to live here moved to floating-date-header.tsx, its only
// remaining consumer: in flow the hairlines read better than a chip, and the
// chip's `bg-background/80 backdrop-blur-sm` only ever existed so the FLOATING
// copy stayed legible over live transcript text. The label itself cannot drift —
// both sites call `dayLabel()` from date-groups.ts.

import { Marker, MarkerContent } from "@ryu/ui/components/marker";
import { cn } from "@ryu/ui/lib/utils";
import { memo } from "react";

/**
 * One day boundary in the transcript.
 *
 * MOUNTED AS A PLAIN, SCROLLER-INVISIBLE ELEMENT, NOT A `MessageScrollerItem` —
 * do not "consistency-fix" this. Two separate reasons, both load-bearing:
 *
 *  1. `MessageScrollerItem` carries `[content-visibility:auto]` with
 *     `[contain-intrinsic-size:auto_10rem]`, i.e. a 160px placeholder reserved
 *     for a ~40px row. Every separator would open a gap it never fills.
 *  2. An item with `scrollAnchor` would be picked as the scroll target when new
 *     content arrives, so a new day would scroll the SEPARATOR to the top
 *     instead of the user's new question. No `messageId` and no `scrollAnchor`
 *     keeps it invisible to the scroller: `handleContentChange` scans forward
 *     for `data-scroll-anchor="true"`, and both the visibility sweep and the
 *     prepend-restore capture `continue` on children with no `data-message-id`.
 *
 * `Marker` satisfies both — it renders a bare `<div>` through `useRender` with no
 * wrapper of its own, and `data-slot` passed as a prop wins over the primitive's
 * own `state.slot` (`mergeObjects(stateProps, resolvedProps)`), so the e2e
 * selector below is preserved. `chat-date-groups-story.spec.ts:111-122` asserts
 * exactly this shape and must keep passing untouched.
 *
 * It must also stay a DIRECT child of `MessageScrollerContent`: the Content's
 * MutationObserver watches `childList` with no `subtree`, so a turn appended
 * inside a per-group wrapper would fire no mutation at all and
 * scroll-new-turn-to-top would die. Interleave, never wrap.
 */
export const DateSeparator = memo(function DateSeparator({
	className,
	label,
}: {
	className?: string;
	label: string;
}) {
	return (
		<Marker
			// Content is `gap-0` (see message-list.tsx): all vertical rhythm between
			// its direct children is explicit top margins, so a run of grouped user
			// messages can sit tighter than the 8px everything else uses. `mt-2`
			// here reproduces the old `gap-2` above the separator, and the turn
			// below it brings its own `mt-2` — so the pair around a day boundary is
			// unchanged at 8px/8px. Tune breathing room with `py-*`, never by
			// widening a gap that would also push every turn apart.
			className={cn("mt-2 shrink-0 py-1", className)}
			data-slot="chat-date-separator"
			variant="separator"
		>
			<MarkerContent className="select-none font-medium text-[11px]">
				{label}
			</MarkerContent>
		</Marker>
	);
});
