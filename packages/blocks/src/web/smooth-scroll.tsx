"use client";

import { cn } from "@ryu/ui/lib/utils.ts";
import type { LenisOptions } from "lenis";
import { ReactLenis, useLenis } from "lenis/react";
import {
	motion,
	useMotionValue,
	useReducedMotion,
	useSpring,
} from "motion/react";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";

const DEFAULT_SPRING = {
	damping: 26,
	mass: 0.25,
	stiffness: 150,
};

export interface SmoothScrollProps
	extends Omit<ComponentProps<typeof ReactLenis>, "options" | "root"> {
	/** Lenis options to merge with the website defaults. */
	options?: LenisOptions;
	/** Use the document scroll container instead of a local wrapper. */
	root?: boolean;
}

/**
 * BeUI-style smooth-scroll provider for the public website.
 *
 * Lenis owns the scroll interpolation while this wrapper keeps the reduced
 * motion path native. Consumers can read the same motion values in either
 * case through `useSmoothScroll`.
 */
export function SmoothScroll({
	children,
	className,
	options,
	root = true,
	...props
}: SmoothScrollProps) {
	const reduce = useReducedMotion();
	const mergedOptions: LenisOptions = {
		duration: 1.05,
		smoothWheel: true,
		...options,
	};

	if (reduce) {
		return <>{children}</>;
	}

	return (
		<ReactLenis
			className={cn("min-h-0", className)}
			options={mergedOptions}
			root={root}
			{...props}
		>
			{children}
		</ReactLenis>
	);
}

export interface SmoothScrollState {
	isScrolling: ReturnType<typeof useMotionValue<boolean>>;
	progress: ReturnType<typeof useMotionValue<number>>;
	scrollTo: (
		target: string | number | HTMLElement,
		immediate?: boolean
	) => void;
	scrollY: ReturnType<typeof useMotionValue<number>>;
	velocity: ReturnType<typeof useMotionValue<number>>;
}

/** Read the active Lenis scroll state as motion values. */
export function useSmoothScroll(): SmoothScrollState {
	const scrollY = useMotionValue(0);
	const progress = useMotionValue(0);
	const velocity = useMotionValue(0);
	const isScrolling = useMotionValue(false);
	const lenis = useLenis((instance) => {
		scrollY.set(instance.scroll);
		progress.set(instance.progress);
		velocity.set(instance.velocity);
		isScrolling.set(instance.isScrolling !== false);
	});

	const scrollTo = useCallback(
		(target: string | number | HTMLElement, immediate = false) => {
			if (lenis) {
				lenis.scrollTo(target, { immediate });
				return;
			}
			if (typeof target === "number") {
				window.scrollTo({
					behavior: immediate ? "auto" : "smooth",
					top: target,
				});
				return;
			}
			const element =
				typeof target === "string"
					? document.querySelector<HTMLElement>(target)
					: target;
			element?.scrollIntoView({ behavior: immediate ? "auto" : "smooth" });
		},
		[lenis]
	);

	const fallbackFrame = useRef<number | null>(null);
	useEffect(() => {
		if (lenis || typeof window === "undefined") {
			return;
		}

		const syncNativeScroll = () => {
			fallbackFrame.current = null;
			const maxScroll =
				document.documentElement.scrollHeight - window.innerHeight;
			const nextScroll = window.scrollY;
			scrollY.set(nextScroll);
			progress.set(maxScroll > 0 ? nextScroll / maxScroll : 0);
			velocity.set(0);
			isScrolling.set(false);
		};
		const onScroll = () => {
			if (fallbackFrame.current !== null) {
				return;
			}
			fallbackFrame.current = window.requestAnimationFrame(syncNativeScroll);
		};
		window.addEventListener("scroll", onScroll, { passive: true });
		syncNativeScroll();
		return () => {
			window.removeEventListener("scroll", onScroll);
			if (fallbackFrame.current !== null) {
				window.cancelAnimationFrame(fallbackFrame.current);
			}
		};
	}, [isScrolling, lenis, progress, scrollY, velocity]);

	return { isScrolling, progress, scrollTo, scrollY, velocity };
}

export interface ScrollProgressProps
	extends Omit<ComponentProps<typeof motion.div>, "style"> {
	className?: string;
}

/** A reduced-motion-safe progress rail for the active scroll context. */
export function ScrollProgress({ className, ...props }: ScrollProgressProps) {
	const { progress } = useSmoothScroll();
	const scaleX = useSpring(progress, DEFAULT_SPRING);

	return (
		<motion.div
			aria-hidden="true"
			className={cn(
				"pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-primary",
				className
			)}
			data-slot="scroll-progress"
			{...props}
			style={{ scaleX }}
		/>
	);
}

export type SmoothScrollChildren = ReactNode;
