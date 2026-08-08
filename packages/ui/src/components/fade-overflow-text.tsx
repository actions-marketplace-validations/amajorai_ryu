"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";

/**
 * A one-line label that dissolves into the background when it is too long for
 * its box, instead of ending in an ellipsis — the treatment the desktop
 * sidebar's chat titles wear.
 *
 * The mask is applied ONLY while the text is actually clipped, and that is the
 * whole reason this component exists rather than a bare `text-fade-edge` class.
 * The mask fades a fixed distance from the right edge, so on a label with room
 * to spare it eats the last characters of a name that was never too long:
 * "Jia Wei" came out looking cut in the account menu. Measuring first means a
 * label that fits stays crisp.
 *
 * `useLayoutEffect` so the measurement lands before paint and the label never
 * flashes masked on its way to unmasked.
 */
export function FadeOverflowText({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	const ref = useRef<HTMLSpanElement>(null);
	const [clipped, setClipped] = useState(false);

	useLayoutEffect(() => {
		const node = ref.current;
		if (!node) {
			return;
		}
		// Sub-pixel widths make `scrollWidth > clientWidth` fire on labels that fit
		// exactly, so require a whole pixel of overflow before masking.
		const measure = () => setClipped(node.scrollWidth - node.clientWidth > 1);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	// Re-measure when the text itself changes: a rename does not resize the box
	// the observer is watching, so nothing above would fire.
	useEffect(() => {
		const node = ref.current;
		if (node) {
			setClipped(node.scrollWidth - node.clientWidth > 1);
		}
	}, [children]);

	return (
		<span
			className={cn(
				"block overflow-hidden whitespace-nowrap",
				clipped && "text-fade-edge",
				className
			)}
			ref={ref}
			// The full name for anyone whose label IS cut; a native tooltip rather
			// than a component one, because this renders inside menu triggers where
			// a second floating layer would fight the menu's own.
			title={clipped ? children : undefined}
		>
			{children}
		</span>
	);
}
