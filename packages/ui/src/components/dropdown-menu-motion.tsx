"use client";

import { SPRING_MORPH } from "@ryu/ui/lib/ease.ts";
import { motion, useAnimationControls, useReducedMotion } from "motion/react";
import type * as React from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

const REDUCED_TRANSITION = { duration: 0.15, ease: "easeOut" } as const;
const MENU_RADIUS = 24;
const CONTENT_FADE = 0.14;
const OPEN_CONTENT_DELAY = 0.06;

type PopupRenderProps = React.ComponentPropsWithRef<"div">;
interface PopupState {
	open: boolean;
}

interface MorphGeometry {
	scaleX: number;
	scaleY: number;
	triggerRadius: number;
	x: number;
	y: number;
}

interface VerticalScrollEdges {
	bottom: boolean;
	top: boolean;
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
	if (typeof ref === "function") {
		ref(value);
		return;
	}
	if (ref) {
		ref.current = value;
	}
}

function clampScale(value: number) {
	return Math.max(0.01, Math.min(value, 4));
}

function triggerElementFor(
	popup: HTMLDivElement,
	labelledBy: string | undefined
): HTMLElement | null {
	if (!labelledBy) {
		return null;
	}
	return popup.ownerDocument.getElementById(labelledBy.split(/\s+/u)[0] ?? "");
}

function triggerRadius(trigger: HTMLElement, height: number) {
	const radius = Number.parseFloat(
		trigger.ownerDocument.defaultView?.getComputedStyle(trigger)
			.borderTopLeftRadius ?? ""
	);
	return Number.isFinite(radius) ? radius : height / 2;
}

function measureMorphGeometry(
	popup: HTMLDivElement,
	labelledBy: string | undefined
): MorphGeometry | null {
	const trigger = triggerElementFor(popup, labelledBy);
	if (!trigger) {
		return null;
	}

	const popupRect = popup.getBoundingClientRect();
	const triggerRect = trigger.getBoundingClientRect();
	if (popupRect.width <= 0 || popupRect.height <= 0) {
		return null;
	}

	return {
		scaleX: clampScale(triggerRect.width / popupRect.width),
		scaleY: clampScale(triggerRect.height / popupRect.height),
		triggerRadius: triggerRadius(trigger, triggerRect.height),
		x: triggerRect.left - popupRect.left,
		y: triggerRect.top - popupRect.top,
	};
}

function scrollFadeStyle(
	edges: VerticalScrollEdges
): React.CSSProperties | undefined {
	if (edges.top && edges.bottom) {
		const mask =
			"linear-gradient(to bottom, transparent 0, #000 1.5rem, #000 calc(100% - 1.5rem), transparent 100%)";
		return { maskImage: mask, WebkitMaskImage: mask };
	}
	if (edges.bottom) {
		const mask =
			"linear-gradient(to bottom, #000 calc(100% - 1.5rem), transparent 100%)";
		return { maskImage: mask, WebkitMaskImage: mask };
	}
	if (edges.top) {
		const mask = "linear-gradient(to bottom, transparent 0, #000 1.5rem)";
		return { maskImage: mask, WebkitMaskImage: mask };
	}
	return undefined;
}

function useVerticalScrollEdges(
	ref: React.RefObject<HTMLElement | null>,
	enabled: boolean
): VerticalScrollEdges {
	const [edges, setEdges] = useState<VerticalScrollEdges>({
		bottom: false,
		top: false,
	});

	const measure = useCallback(() => {
		const element = ref.current;
		if (!element) {
			return;
		}

		const overflow = element.scrollHeight - element.clientHeight;
		const nextEdges = {
			bottom: overflow > 1 && element.scrollTop < overflow - 1,
			top: element.scrollTop > 1,
		};
		setEdges((current) =>
			current.top === nextEdges.top && current.bottom === nextEdges.bottom
				? current
				: nextEdges
		);
	}, [ref]);

	useLayoutEffect(() => {
		const element = ref.current;
		if (!(enabled && element)) {
			setEdges((current) =>
				current.top || current.bottom ? { bottom: false, top: false } : current
			);
			return;
		}

		measure();
		element.addEventListener("scroll", measure, { passive: true });

		const resizeObserver =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(measure);
		resizeObserver?.observe(element);
		for (const child of Array.from(element.children)) {
			resizeObserver?.observe(child);
		}

		const mutationObserver =
			typeof MutationObserver === "undefined"
				? null
				: new MutationObserver(measure);
		mutationObserver?.observe(element, {
			childList: true,
			subtree: true,
		});

		return () => {
			element.removeEventListener("scroll", measure);
			resizeObserver?.disconnect();
			mutationObserver?.disconnect();
		};
	}, [enabled, measure, ref]);

	return edges;
}

/**
 * Replaces Base UI's popup render element with one animated glass surface.
 * The popup remains Base UI's focusable element; Motion only owns the visual
 * transform, which lets Base UI wait for the same Web Animations API lifecycle
 * before unmounting the menu on close.
 */
export function renderMorphingDropdownPopup(
	props: PopupRenderProps,
	state: PopupState
): React.ReactElement {
	return <MorphingDropdownPopup {...props} popupState={state} />;
}

function MorphingDropdownPopup({
	popupState: state,
	...props
}: PopupRenderProps & { popupState: PopupState }): React.ReactElement {
	const {
		children,
		ref: forwardedRef,
		style: forwardedStyle,
		...elementProps
	} = props;
	const popupRef = useRef<HTMLDivElement>(null);
	const controls = useAnimationControls();
	const prefersReducedMotion = useReducedMotion();
	const geometryRef = useRef<MorphGeometry | null>(null);
	const [ready, setReady] = useState(false);
	const scrollEdges = useVerticalScrollEdges(popupRef, state.open);
	const labelledBy =
		typeof props["aria-labelledby"] === "string"
			? props["aria-labelledby"]
			: undefined;
	const transition = prefersReducedMotion ? REDUCED_TRANSITION : SPRING_MORPH;
	const motionElementProps = elementProps as React.ComponentProps<
		typeof motion.div
	>;

	const setPopupRef = useCallback(
		(element: HTMLDivElement | null) => {
			popupRef.current = element;
			assignRef(forwardedRef, element);
		},
		[forwardedRef]
	);

	useLayoutEffect(() => {
		const popup = popupRef.current;
		controls.stop();

		if (!(state.open && popup)) {
			const geometry = geometryRef.current;
			if (geometry) {
				void controls.start(
					{
						x: geometry.x,
						y: geometry.y,
						scaleX: geometry.scaleX,
						scaleY: geometry.scaleY,
						borderRadius: geometry.triggerRadius,
					},
					transition
				);
			}
			return () => controls.stop();
		}

		setReady(false);
		controls.set({
			x: 0,
			y: 0,
			scaleX: 1,
			scaleY: 1,
			borderRadius: MENU_RADIUS,
		});

		let frame = 0;
		const open = () => {
			const nextGeometry = measureMorphGeometry(popup, labelledBy);
			if (!nextGeometry) {
				setReady(true);
				return;
			}

			geometryRef.current = nextGeometry;
			controls.stop();
			controls.set({
				x: nextGeometry.x,
				y: nextGeometry.y,
				scaleX: nextGeometry.scaleX,
				scaleY: nextGeometry.scaleY,
				borderRadius: nextGeometry.triggerRadius,
			});
			setReady(true);
			void controls.start(
				{
					x: 0,
					y: 0,
					scaleX: 1,
					scaleY: 1,
					borderRadius: MENU_RADIUS,
				},
				transition
			);
		};

		frame = requestAnimationFrame(open);
		return () => {
			cancelAnimationFrame(frame);
			controls.stop();
		};
	}, [controls, labelledBy, state.open, transition]);

	return (
		<motion.div
			{...motionElementProps}
			animate={controls}
			data-scroll-edges={
				scrollEdges.top && scrollEdges.bottom
					? "both"
					: scrollEdges.top
						? "top"
						: scrollEdges.bottom
							? "bottom"
							: "none"
			}
			ref={setPopupRef}
			style={{
				...forwardedStyle,
				...scrollFadeStyle(scrollEdges),
				transformOrigin: "top left",
				visibility: ready ? "visible" : "hidden",
			}}
		>
			<motion.div
				animate={{ opacity: state.open ? 1 : 0 }}
				initial={{ opacity: 0 }}
				style={{ pointerEvents: state.open ? "auto" : "none" }}
				transition={{
					delay: state.open ? OPEN_CONTENT_DELAY : 0,
					duration: CONTENT_FADE,
				}}
			>
				{children}
			</motion.div>
		</motion.div>
	);
}
