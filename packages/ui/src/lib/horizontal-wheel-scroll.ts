const HORIZONTAL_SCROLL_SLACK = 1;
const WHEEL_LINE_HEIGHT = 16;

const SCROLLABLE_OVERFLOW_X = new Set(["auto", "overlay", "scroll"]);

export interface HorizontalWheelElement {
	clientHeight: number;
	clientWidth: number;
	parentElement: HorizontalWheelElement | null;
	scrollHeight: number;
	scrollLeft: number;
	scrollWidth: number;
}

export interface HorizontalWheelEvent {
	ctrlKey: boolean;
	defaultPrevented: boolean;
	deltaMode: number;
	deltaX: number;
	deltaY: number;
	preventDefault: () => void;
	target: unknown;
}

type OverflowXReader = (element: HorizontalWheelElement) => string;

/** Convert a wheel delta into pixels without changing the browser's direction. */
export function normalizeWheelDelta(
	delta: number,
	deltaMode: number,
	viewportSize: number
): number {
	if (deltaMode === 1) {
		return delta * WHEEL_LINE_HEIGHT;
	}
	if (deltaMode === 2) {
		return delta * viewportSize;
	}
	return delta;
}

/**
 * Create the delegated wheel handler. The reader is injectable so the event
 * rules can be tested with structural elements without requiring a DOM shim.
 */
export function createHorizontalWheelHandler(
	getOverflowX: OverflowXReader = readOverflowX
): (event: HorizontalWheelEvent) => void {
	return (event) => {
		if (
			event.defaultPrevented ||
			event.ctrlKey ||
			event.deltaY === 0 ||
			!Number.isFinite(event.deltaY) ||
			!Number.isFinite(event.deltaX)
		) {
			return;
		}

		const firstElement = elementFromTarget(event.target);
		if (!firstElement) {
			return;
		}

		const visited = new Set<HorizontalWheelElement>();
		let candidate: HorizontalWheelElement | null = firstElement;
		while (candidate && !visited.has(candidate)) {
			visited.add(candidate);
			if (isEligibleScroller(candidate, getOverflowX)) {
				const delta =
					normalizeWheelDelta(
						event.deltaX,
						event.deltaMode,
						candidate.clientWidth
					) +
					normalizeWheelDelta(
						event.deltaY,
						event.deltaMode,
						candidate.clientHeight
					);

				if (delta !== 0 && moveScrollLeft(candidate, delta)) {
					event.preventDefault();
					return;
				}
			}
			candidate = parentElementOf(candidate);
		}
	};
}

const installedDocuments = new WeakMap<Document, () => void>();

/** Install the wheel adapter once for a browser document. */
export function installHorizontalWheelScrolling(
	targetDocument?: Document
): () => void {
	const ownerDocument =
		targetDocument ?? (typeof document === "undefined" ? null : document);
	if (!ownerDocument || installedDocuments.has(ownerDocument)) {
		return () => {};
	}

	const handler = createHorizontalWheelHandler();
	const listener = handler as unknown as EventListener;
	ownerDocument.addEventListener("wheel", listener, { passive: false });

	const cleanup = () => {
		if (!installedDocuments.has(ownerDocument)) {
			return;
		}
		ownerDocument.removeEventListener("wheel", listener);
		installedDocuments.delete(ownerDocument);
	};
	installedDocuments.set(ownerDocument, cleanup);
	return cleanup;
}

function isEligibleScroller(
	element: HorizontalWheelElement,
	getOverflowX: OverflowXReader
): boolean {
	const overflowX = getOverflowX(element).trim().toLowerCase();
	const hasHorizontalOverflow =
		element.scrollWidth - element.clientWidth > HORIZONTAL_SCROLL_SLACK;
	const hasVerticalOverflow =
		element.scrollHeight - element.clientHeight > HORIZONTAL_SCROLL_SLACK;

	return (
		hasHorizontalOverflow &&
		!hasVerticalOverflow &&
		SCROLLABLE_OVERFLOW_X.has(overflowX)
	);
}

function moveScrollLeft(
	element: HorizontalWheelElement,
	delta: number
): boolean {
	const before = element.scrollLeft;
	element.scrollLeft += delta;
	return element.scrollLeft !== before;
}

function readOverflowX(element: HorizontalWheelElement): string {
	if (typeof globalThis.getComputedStyle !== "function") {
		return "";
	}
	return globalThis.getComputedStyle(element as unknown as Element).overflowX;
}

function elementFromTarget(target: unknown): HorizontalWheelElement | null {
	const direct = asHorizontalWheelElement(target);
	if (direct) {
		return direct;
	}
	if (isRecord(target)) {
		return asHorizontalWheelElement(target.parentElement);
	}
	return null;
}

function parentElementOf(
	element: HorizontalWheelElement
): HorizontalWheelElement | null {
	return asHorizontalWheelElement(element.parentElement);
}

function asHorizontalWheelElement(
	value: unknown
): HorizontalWheelElement | null {
	if (!isRecord(value)) {
		return null;
	}
	if (
		typeof value.clientHeight !== "number" ||
		typeof value.clientWidth !== "number" ||
		typeof value.scrollHeight !== "number" ||
		typeof value.scrollLeft !== "number" ||
		typeof value.scrollWidth !== "number"
	) {
		return null;
	}
	return value as unknown as HorizontalWheelElement;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
