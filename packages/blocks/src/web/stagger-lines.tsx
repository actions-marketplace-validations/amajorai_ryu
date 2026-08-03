"use client";

import { cn } from "@ryu/ui/lib/utils";
import { useInView } from "motion/react";
import {
	Children,
	cloneElement,
	isValidElement,
	type ReactElement,
	type ReactNode,
	useRef,
} from "react";

/**
 * globals.css only spells out `.t-stagger-line--1` … `--4`; a fifth line would
 * silently fall back to a 0s delay and land with line one. Clamping keeps a long
 * header reading as a cascade that flattens at the end rather than one that
 * breaks in the middle.
 */
const MAX_STAGGER_LINE = 4;

interface StaggerLinesProps {
	children: ReactNode;
	className?: string;
}

interface StyledProps {
	className?: string;
}

/**
 * Landing-block adapter for the shared `.t-stagger` reveal in globals.css: the
 * heading and its supporting line rise, sharpen and fade in one after the other
 * once the block scrolls into view.
 *
 * This renders the container itself (rather than nesting inside one) so call
 * sites convert their existing header wrapper into a `StaggerLines` and add no
 * DOM node — `mx-auto`, `text-center` and `mb-10` keep working untouched.
 *
 * Two things it deliberately does not do:
 * - It adds no transition of its own. Every property, duration and the
 *   `prefers-reduced-motion` fallback (lines rest visible, not invisible) live
 *   with the classes in globals.css.
 * - `.t-stagger-line` sets `display: block` from an unlayered rule, which beats
 *   Tailwind's `@layer utilities`. So only pass block-level text children —
 *   a `flex` row handed in as a line would lose its layout. Wrap just the
 *   heading and supporting line, and leave sibling CTA rows outside.
 *
 * `useInView` mirrors `reveal.tsx` so the whole landing page shares one
 * scroll-trigger; it also fires immediately for anything already on screen, so
 * above-the-fold and below-the-fold headers need no separate mount path.
 */
export function StaggerLines({ children, className }: StaggerLinesProps) {
	const ref = useRef<HTMLDivElement>(null);
	const inView = useInView(ref, { once: true, margin: "-80px" });

	return (
		<div className={cn("t-stagger", inView && "is-shown", className)} ref={ref}>
			{Children.toArray(children).map((child, index) => {
				if (!isValidElement(child)) {
					return child;
				}
				const element = child as ReactElement<StyledProps>;
				return cloneElement(element, {
					className: cn(
						"t-stagger-line",
						`t-stagger-line--${Math.min(index + 1, MAX_STAGGER_LINE)}`,
						element.props.className
					),
				});
			})}
		</div>
	);
}
