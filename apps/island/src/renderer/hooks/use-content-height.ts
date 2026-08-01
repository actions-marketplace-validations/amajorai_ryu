// Measures the *natural* height of whatever is currently drawn inside the island's
// detail shape, so the shape can grow to fit it (see `pillHeight` in
// island-config.ts) instead of clipping everything past a single row.
//
// Two rules make this safe:
//
//   1. The returned ref MUST be attached to an auto-height node. Attaching it to
//      anything the island sizes (an `h-full` wrapper) feeds the animated height
//      back into the measurement, and the pill oscillates forever.
//   2. It reports 0 whenever nothing is mounted. The detail content lives inside
//      an `AnimatePresence mode="wait"` keyed on the island state, so the old
//      surface unmounts before the new one mounts; without the reset the new
//      surface would briefly be sized to the previous one's content.

import { useCallback, useRef, useState } from "react";

/** Sub-pixel changes below this (px) are ignored, so layout jitter can't thrash. */
const HEIGHT_EPSILON = 1;

export interface ContentHeight {
	/** Measured natural height (px) of the observed node; 0 when unmounted. */
	height: number;
	/** Callback ref for the auto-height node to observe. */
	ref: (node: HTMLElement | null) => void;
}

export function useContentHeight(): ContentHeight {
	const [height, setHeight] = useState(0);
	const observerRef = useRef<ResizeObserver | null>(null);

	const ref = useCallback((node: HTMLElement | null) => {
		observerRef.current?.disconnect();
		observerRef.current = null;
		if (node === null) {
			setHeight(0);
			return;
		}
		const observer = new ResizeObserver((entries) => {
			const next = Math.round(entries[0]?.contentRect.height ?? 0);
			setHeight((prev) =>
				Math.abs(prev - next) < HEIGHT_EPSILON ? prev : next
			);
		});
		observer.observe(node);
		observerRef.current = observer;
		// Seed synchronously so the pill does not sit at its base height for a frame
		// while the observer's first callback lands. `offsetHeight`, not
		// `getBoundingClientRect()`: the content mounts inside a `scale: 0.92` entry
		// transform, which the rect reflects and the layout box does not — seeding
		// from the rect would report ~92% of the natural height and then correct.
		setHeight(node.offsetHeight);
	}, []);

	return { height, ref };
}
