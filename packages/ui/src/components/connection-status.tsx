"use client";

import type { ConnectionPhase } from "@ryuhq/protocol/connection-status";
import { Check, RefreshCw, ServerOff, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils.ts";
import { Button } from "./button.tsx";
import { Spinner } from "./spinner.tsx";

/** The compact connection states used by status dots in host navigation. */
export type ConnectionDotState = "checking" | "offline" | "online";

/**
 * A small, accessible connection indicator for dense navigation rows.
 *
 * The host supplies the state and accessible label; this primitive owns the
 * semantic colors so a sidebar, node picker, or app row does not grow its own
 * status palette.
 */
export function ConnectionStatusDot({
	className,
	label,
	state,
}: {
	className?: string;
	label: string;
	state: ConnectionDotState;
}) {
	const tone =
		state === "online"
			? "bg-success"
			: state === "offline"
				? "bg-destructive"
				: "bg-muted-foreground/40";
	return (
		<span
			aria-label={label}
			className={cn(
				"inline-block size-2 shrink-0 rounded-full",
				tone,
				className
			)}
			data-connection-dot-state={state}
			role="img"
			title={label}
		/>
	);
}

interface ConnectionStatusCopy {
	detail: string;
	title: string;
}

/** Controlled inputs for the shared web/extension connection status surface. */
export interface ConnectionStatusToastProps {
	/** Allows a host to add a class without taking over the component geometry. */
	className?: string;
	/** The selected node shown in the node-unreachable and reconnecting copy. */
	nodeName?: string;
	/** Optional manual retry action. It is only shown for node-unreachable. */
	onRetry?: () => void;
	phase: ConnectionPhase;
	/** Brief success state shown after the host moves from unavailable to online. */
	restored?: boolean;
	retrying?: boolean;
}

/** Backwards-compatible name for callers that use the presentational view. */
export type ConnectionStatusToastViewProps = ConnectionStatusToastProps;

function copyForPhase(
	phase: ConnectionPhase,
	nodeName: string,
	restored: boolean
): ConnectionStatusCopy {
	if (restored) {
		return {
			detail: `Reconnected to ${nodeName}.`,
			title: "Connection restored",
		};
	}
	if (phase === "offline") {
		return {
			detail: "Waiting for connectivity…",
			title: "Offline mode",
		};
	}
	if (phase === "node-unreachable") {
		return {
			detail: `Can’t reach ${nodeName}. Reconnecting automatically…`,
			title: "Node offline",
		};
	}
	return {
		detail: "Checking the node and keeping this window available…",
		title: `Connecting to ${nodeName}`,
	};
}

function phaseIcon(phase: ConnectionPhase, restored: boolean): ReactNode {
	if (restored) {
		return <Check aria-hidden="true" className="size-3.5" />;
	}
	if (phase === "offline") {
		return <WifiOff aria-hidden="true" className="size-3.5" />;
	}
	if (phase === "node-unreachable") {
		return <ServerOff aria-hidden="true" className="size-3.5" />;
	}
	return <Spinner aria-hidden="true" className="size-3.5" />;
}

function phaseIconClass(phase: ConnectionPhase, restored: boolean): string {
	if (restored) {
		return "bg-emerald-400/15 text-emerald-300 ring-emerald-300/25";
	}
	if (phase === "checking") {
		return "bg-sky-400/15 text-sky-300 ring-sky-300/25";
	}
	if (phase === "offline") {
		return "bg-sky-400/15 text-sky-300 ring-sky-300/25";
	}
	return "bg-amber-400/15 text-amber-200 ring-amber-300/25";
}

/**
 * Compact fixed status surface for web hosts.
 *
 * It intentionally owns no network calls or node state. A host supplies the
 * same four-phase contract and can therefore use this in the shell, Gateway,
 * Spaces, databases, multiplayer, or a standalone app surface.
 */
export function ConnectionStatusToast({
	className,
	nodeName = "Ryu",
	onRetry,
	phase,
	restored = false,
	retrying = false,
}: ConnectionStatusToastProps) {
	if (phase === "online" && !restored) {
		return null;
	}

	const copy = copyForPhase(phase, nodeName, restored);

	return (
		<div
			className={cn(
				"fade-in-0 slide-in-from-top-1 pointer-events-none fixed inset-x-0 top-12 z-[100] flex animate-in justify-center px-4 duration-200 motion-reduce:animate-none sm:px-6",
				className
			)}
			data-connection-phase={phase}
			data-connection-restored={restored ? "true" : undefined}
			data-testid="connection-status-toast"
		>
			<div
				aria-live="polite"
				className="pointer-events-auto relative flex w-fit max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-white/15 bg-zinc-900/90 px-2 py-1.5 text-white shadow-[0_14px_35px_-16px_rgba(0,0,0,0.72)] ring-1 ring-white/10 ring-inset backdrop-blur-2xl backdrop-saturate-150"
				data-slot="connection-status-surface"
				role="status"
			>
				<span
					aria-hidden="true"
					className={cn(
						"flex size-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset",
						phaseIconClass(phase, restored)
					)}
				>
					{phaseIcon(phase, restored)}
				</span>
				<span className="min-w-0 flex-1 py-0.5">
					<span
						className="block truncate text-center font-medium text-[11px] leading-[1.2] tracking-[-0.01em]"
						data-slot="connection-status-title"
					>
						{copy.title}
					</span>
					<span
						className="block truncate text-center text-[10px] text-white/60 leading-[1.25]"
						data-slot="connection-status-detail"
					>
						{copy.detail}
					</span>
				</span>
				{phase === "node-unreachable" && onRetry ? (
					<Button
						aria-label={retrying ? "Checking connection" : "Retry"}
						className="corner-round size-7 shrink-0 rounded-full border border-white/10 bg-white/10 p-0 text-white/90 shadow-none hover:bg-white/15 hover:text-white focus-visible:border-white/30 focus-visible:ring-white/30"
						data-slot="connection-status-retry"
						disabled={retrying}
						onClick={onRetry}
						size="icon-xs"
						title={retrying ? "Checking connection" : "Retry connection"}
						variant="ghost"
					>
						<RefreshCw
							aria-hidden="true"
							className={cn("size-3.5", retrying && "animate-spin")}
						/>
						<span className="sr-only">
							{retrying ? "Checking connection" : "Retry"}
						</span>
					</Button>
				) : null}
			</div>
		</div>
	);
}

/** Explicit alias for hosts that distinguish the view from their adapter. */
export const ConnectionStatusToastView = ConnectionStatusToast;

export type { ConnectionPhase } from "@ryuhq/protocol/connection-status";
