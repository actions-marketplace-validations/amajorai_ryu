"use client";

import { cn } from "@ryu/ui/lib/utils.ts";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * transitions.dev "success check" (10) as a React primitive.
 *
 * The icon fades in, rotates upright, settles with a Y-bob and draws its stroke
 * — the confirmation beat on terminal success pages (device activated, email
 * verified, payment complete). Appear only: success states are persistent, so
 * there is no exit transition. Honors prefers-reduced-motion via the shared
 * guard in globals.css, which rests the icon visible and fully drawn.
 *
 * Pass `children` to swap the icon. Every `<path>` in the SVG is measured with
 * getTotalLength() and gets its own dasharray/dashoffset, so multi-path icons
 * draw correctly; non-`<path>` shapes (circle, rect) are not stroke-animated
 * and will simply appear with the fade.
 */

interface SuccessCheckProps {
	/** Custom icon markup. Defaults to a stroked check mark in currentColor. */
	children?: ReactNode;
	/** Sizes the wrapper — the default icon fills it (e.g. `"size-10"`). */
	className?: string;
}

export function SuccessCheck({ children, className }: SuccessCheckProps) {
	const wrapperRef = useRef<HTMLSpanElement>(null);
	const [state, setState] = useState<"in" | "out">("out");

	useEffect(() => {
		const wrapper = wrapperRef.current;
		if (!wrapper) {
			return;
		}
		// Measure before flipping to "in": the CSS dasharray is a placeholder, and
		// a stroke whose dasharray is shorter than its path pre-reveals. Safe in a
		// passive effect rather than useLayoutEffect because data-state="out"
		// holds the icon at opacity 0 until this runs.
		for (const path of wrapper.querySelectorAll<SVGPathElement>("svg path")) {
			const length = Math.ceil(path.getTotalLength());
			path.style.strokeDasharray = String(length);
			path.style.strokeDashoffset = String(length);
		}
		setState("in");
	}, []);

	return (
		<span
			aria-hidden="true"
			className={cn("t-success-check", className)}
			data-state={state}
			ref={wrapperRef}
		>
			{children ?? (
				<svg
					className="size-full"
					fill="none"
					stroke="currentColor"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={3}
					viewBox="0 0 24 24"
				>
					<path d="M20 6 9 17l-5-5" />
				</svg>
			)}
		</span>
	);
}

export default SuccessCheck;
