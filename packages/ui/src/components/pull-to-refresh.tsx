import { RefreshCw } from "lucide-react";
import type {
	ReactNode,
	PointerEvent as ReactPointerEvent,
	Ref,
	UIEvent,
} from "react";
import { useRef, useState } from "react";
import { cn } from "../lib/utils.ts";

const THRESHOLD = 72;
const MAX_PULL = 112;

/** A small, dependency-free pull gesture for scrollable data surfaces. */
export function PullToRefresh({
	children,
	onRefresh,
	className,
	ariaLabel = "Pull to refresh",
	onScroll,
	scrollRef,
}: {
	children: ReactNode;
	onRefresh: () => void | Promise<void>;
	className?: string;
	ariaLabel?: string;
	onScroll?: (event: UIEvent<HTMLDivElement>) => void;
	scrollRef?: Ref<HTMLDivElement>;
}) {
	const [pull, setPull] = useState(0);
	const [refreshing, setRefreshing] = useState(false);
	const start = useRef<number | null>(null);
	const active = useRef(false);

	const finish = async () => {
		const shouldRefresh = pull >= THRESHOLD;
		setPull(0);
		active.current = false;
		if (!shouldRefresh) {
			return;
		}
		setRefreshing(true);
		try {
			await onRefresh();
		} finally {
			setRefreshing(false);
		}
	};

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.currentTarget.scrollTop !== 0 || refreshing) {
			return;
		}
		start.current = event.clientY;
		active.current = true;
		event.currentTarget.setPointerCapture(event.pointerId);
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!active.current || start.current === null) {
			return;
		}
		const distance = event.clientY - start.current;
		if (distance <= 0) {
			return;
		}
		event.preventDefault();
		setPull(Math.min(MAX_PULL, distance * 0.48));
	};

	return (
		<div
			aria-label={ariaLabel}
			className={cn("relative overflow-y-auto", className)}
			onPointerCancel={() => {
				active.current = false;
				setPull(0);
			}}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={() => {
				void finish();
			}}
			onScroll={onScroll}
			ref={scrollRef}
			style={{ touchAction: pull > 0 ? "none" : "pan-y" }}
		>
			<div className="pointer-events-none sticky top-0 z-20 flex h-0 justify-center overflow-visible">
				<div
					className="flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-[10px] text-muted-foreground shadow-sm transition-opacity"
					style={{
						opacity: pull > 4 || refreshing ? 1 : 0,
						transform: `translateY(${pull - 28}px)`,
					}}
				>
					<RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
					{refreshing
						? "Refreshing…"
						: pull >= THRESHOLD
							? "Release to refresh"
							: "Pull to refresh"}
				</div>
			</div>
			<div
				style={{
					transform: `translateY(${pull}px)`,
					transition: active.current
						? "none"
						: "transform 220ms cubic-bezier(.22,1,.36,1)",
				}}
			>
				{children}
			</div>
		</div>
	);
}
