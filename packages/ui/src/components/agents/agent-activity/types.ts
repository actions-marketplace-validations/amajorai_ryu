import type { ReactNode } from "react";

export type AgentActivityStatus = "working" | "complete";
export type AgentStepStatus = "pending" | "active" | "complete";

export interface AgentActivityStep {
	id: string;
	label: ReactNode;
	meta?: ReactNode;
	status?: AgentStepStatus;
	type: "step";
}

export interface AgentActivityText {
	content: ReactNode;
	id: string;
	type: "text";
}

export interface AgentSearchResult {
	domain?: ReactNode;
	icon?: ReactNode;
	id: string;
	title: ReactNode;
	url?: string;
}

export interface AgentActivitySearch {
	id: string;
	moreCount?: number;
	query: ReactNode;
	results?: AgentSearchResult[];
	type: "search";
}

export interface AgentActivityTool {
	action: "read" | "edit" | "run" | (string & {});
	additions?: number;
	deletions?: number;
	id: string;
	target: ReactNode;
	type: "tool";
}

export type AgentTraceKind =
	| "thinking"
	| "message"
	| "write"
	| "run"
	| "read"
	| (string & {});

export interface AgentActivityTrace {
	detail?: ReactNode;
	icon?: ReactNode;
	id: string;
	kind: AgentTraceKind;
	label: ReactNode;
	type: "trace";
}

export type AgentActivityItem =
	| AgentActivityStep
	| AgentActivityText
	| AgentActivitySearch
	| AgentActivityTool
	| AgentActivityTrace;

export type AgentActivityContentType = AgentActivityItem["type"] | "mixed";

export interface AgentActivityProps {
	/** Optional label shown while the run is active. */
	activeLabel?: ReactNode;
	className?: string;
	/** Collapse the disclosure when status changes from working to complete. */
	collapseOnComplete?: boolean;
	contentClassName?: string;
	/** Expected activity kind before the first streamed item arrives. */
	contentType?: AgentActivityContentType;
	/** Initial expanded state used after the run completes. */
	defaultOpen?: boolean;
	/** Elapsed run time, in seconds. Used by the step-only summary. */
	duration?: number;
	/** Chronological activity entries. Append or update items as events stream. */
	items: AgentActivityItem[];
	/** Maximum visible activity height before the stream begins gliding. */
	maxHeight?: number;
	/** Called when the completed activity disclosure changes state. */
	onOpenChange?: (open: boolean) => void;
	/** Controlled expanded state used after the run completes. */
	open?: boolean;
	/** Current run phase. Active runs always stay expanded. */
	status?: AgentActivityStatus;
	/** Optional completed summary. Derived from the item types by default. */
	summary?: ReactNode;
}
