"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

function findScrollParent(element: HTMLElement): HTMLElement | null {
	const popup = element.closest<HTMLElement>(
		'[data-slot="dropdown-menu-content"]'
	);
	if (popup) {
		return popup;
	}

	let parent = element.parentElement;
	while (parent) {
		const overflowY = getComputedStyle(parent).overflowY;
		if (
			overflowY === "auto" ||
			overflowY === "overlay" ||
			overflowY === "scroll"
		) {
			return parent;
		}
		parent = parent.parentElement;
	}
	return null;
}

/**
 * Mount a long menu in small windows and grow it as the user reaches the end.
 * The popup owns the scrollbar; this component only owns the DOM window, so it
 * can be used inside both a root menu and a submenu without creating nested
 * scroll containers.
 */
export function InfiniteMenuItems<T>({
	items,
	pageSize = 40,
	renderItem,
	resetKey,
}: {
	items: readonly T[];
	pageSize?: number;
	renderItem: (item: T, index: number) => ReactNode;
	resetKey?: string;
}) {
	const [visibleCount, setVisibleCount] = useState(pageSize);
	const sentinelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		setVisibleCount(pageSize);
	}, [pageSize, resetKey]);

	useEffect(() => {
		const sentinel = sentinelRef.current;
		if (!sentinel || visibleCount >= items.length) {
			return;
		}
		const scrollParent = findScrollParent(sentinel);
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) {
					return;
				}
				setVisibleCount((current) =>
					Math.min(items.length, current + pageSize)
				);
			},
			{ root: scrollParent, rootMargin: "160px 0px" }
		);
		observer.observe(sentinel);
		const loadAtEnd = () => {
			if (
				scrollParent &&
				scrollParent.scrollTop + scrollParent.clientHeight >=
					scrollParent.scrollHeight - 160
			) {
				setVisibleCount((current) =>
					Math.min(items.length, current + pageSize)
				);
			}
		};
		scrollParent?.addEventListener("scroll", loadAtEnd, { passive: true });
		return () => {
			observer.disconnect();
			scrollParent?.removeEventListener("scroll", loadAtEnd);
		};
	}, [items.length, pageSize, visibleCount]);

	return (
		<>
			{items
				.slice(0, visibleCount)
				.map((item, index) => renderItem(item, index))}
			{visibleCount < items.length && (
				<div aria-hidden="true" className="h-px w-full" ref={sentinelRef} />
			)}
		</>
	);
}
