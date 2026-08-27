"use client";

import { cn } from "@ryu/ui/lib/utils.ts";
import type * as React from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

type PopupRenderProps = React.ComponentPropsWithRef<"div">;

type DropdownSide =
	| "bottom"
	| "inline-end"
	| "inline-start"
	| "left"
	| "right"
	| "top";
type DropdownAlign = "center" | "end" | "start";

interface PopupState {
	align: DropdownAlign;
	open: boolean;
	side: DropdownSide;
}

export type DropdownOrigin =
	| "bottom-center"
	| "bottom-left"
	| "bottom-right"
	| "top-center"
	| "top-left"
	| "top-right";

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

export function dropdownOriginFor(
	side: DropdownSide,
	align: DropdownAlign
): DropdownOrigin {
	const verticalOrigin =
		side === "top" || (side !== "bottom" && align === "end") ? "bottom" : "top";
	const horizontalOrigin =
		side === "left" || side === "inline-start"
			? "right"
			: side === "right" || side === "inline-end"
				? "left"
				: align === "end"
					? "right"
					: align === "center"
						? "center"
						: "left";

	return `${verticalOrigin}-${horizontalOrigin}` as DropdownOrigin;
}

export function dropdownMotionClassNames(
	open: boolean,
	openReady: boolean
): string {
	if (!open) {
		return "t-dropdown is-closing";
	}
	return cn("t-dropdown", openReady && "is-open");
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

function useDropdownOpenReady(open: boolean): boolean {
	const [openReady, setOpenReady] = useState(false);

	useEffect(() => {
		if (!open) {
			setOpenReady(false);
			return;
		}

		setOpenReady(false);
		const frame = requestAnimationFrame(() => setOpenReady(true));
		return () => cancelAnimationFrame(frame);
	}, [open]);

	return openReady;
}

/**
 * Applies the shared Transitions.dev scale/fade surface to Base UI's popup.
 * Base UI keeps the popup mounted while the ending transition is active, so
 * the `.is-closing` state can finish before focus and the portal are released.
 */
export function renderDropdownPopup(
	props: PopupRenderProps,
	state: PopupState
): React.ReactElement {
	return <AnimatedDropdownPopup {...props} popupState={state} />;
}

function AnimatedDropdownPopup({
	popupState: state,
	...props
}: PopupRenderProps & { popupState: PopupState }): React.ReactElement {
	const {
		children,
		className,
		ref: forwardedRef,
		style: forwardedStyle,
		...elementProps
	} = props;
	const popupRef = useRef<HTMLDivElement>(null);
	const forwardedRefRef = useRef(forwardedRef);
	const openReady = useDropdownOpenReady(state.open);
	const scrollEdges = useVerticalScrollEdges(popupRef, state.open);

	useLayoutEffect(() => {
		forwardedRefRef.current = forwardedRef;
	}, [forwardedRef]);

	const setPopupRef = useCallback((element: HTMLDivElement | null) => {
		popupRef.current = element;
		assignRef(forwardedRefRef.current, element);
	}, []);

	return (
		<div
			{...elementProps}
			className={cn(className, dropdownMotionClassNames(state.open, openReady))}
			data-origin={dropdownOriginFor(state.side, state.align)}
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
			}}
		>
			{children}
		</div>
	);
}
