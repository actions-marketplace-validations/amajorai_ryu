import type { GlyphValue } from "@ryu/ui/components/glyph.ts";
import type { ResourceVisibility } from "@/src/lib/resource-visibility.ts";

export interface Agent {
	description: string;
	id: string;
	name: string;
}

export interface Message {
	content: string;
	id: string;
	/**
	 * This assistant turn was cut off mid-stream and never finalized — the node
	 * died while it was still being written, so `content`/`parts` hold only what
	 * had been flushed. Stamped by Core's boot reconciliation (nothing can mark it
	 * live: a process that dies never gets to say so), and rendered as an explicit
	 * "cut off" marker rather than passing a truncated reply off as a whole one.
	 */
	interrupted?: boolean;
	originServer?: string;
	/** The message this one replied to (its parent in the version tree). */
	parentMessageId?: string;
	/**
	 * Structured render parts (AI SDK reduced UIMessage `parts`) rehydrated from
	 * Core when present — tool / text / file parts captured server-side as the turn
	 * streamed. Lets a reloaded conversation re-render its tool rows + cowork
	 * context instead of collapsing to flat `content`. Absent for user turns and
	 * for messages persisted before parts capture existed (fall back to a text part
	 * built from `content`).
	 */
	parts?: unknown[];
	role: "user" | "assistant";
	siblingCount?: number;
	/** Ids of every version at this branch point in pager order (v1..vN); lets the
	 * pager map a step to a `selectVersion` target. Empty for unbranched turns. */
	siblingIds?: string[];
	/**
	 * Version-tree position (ChatGPT/Claude-style edit + regenerate branching).
	 * `siblingCount > 1` means this turn has alternate versions and the client
	 * renders a `< n / m >` pager; `siblingIndex` is the 0-based active version.
	 * Both come from Core's active-path read; absent/1 for never-branched turns.
	 */
	siblingIndex?: number;
	source?: string;
	timestamp: number;
	widgetInstanceId?: string;
}

export interface Conversation {
	agentId?: string;
	/** Server-backed archive (shared with coordinator threads). */
	archived?: boolean;
	/** Git branch at run start (M1). */
	branch?: string;
	createdAt: number;
	/** Active working folder at run start (M1). */
	folderPath?: string;
	/** Notion-style glyph from the shared GlyphPicker; null/undefined = title only. */
	icon?: GlyphValue;
	id: string;
	/** One flattened line of the newest message, for messaging-style rows. Only
	 * populated while the sidebar asks Core for previews (`?preview=1`); every
	 * other load leaves it undefined. */
	lastMessage?: string;
	/** Unix ms of that message — distinct from `updatedAt`, which also moves on
	 * renames, pins and run-status writes. */
	lastMessageAt?: number;
	/** Role that wrote it, so a row can prefix "You: ". */
	lastMessageRole?: string;
	/** Authoritative message total returned by Core's conversation summary. */
	messageCount?: number;
	messages: Message[];
	/** Agent ids participating in this conversation (council / multi-agent). */
	participants?: string[];
	/** Server-backed pin (shared with coordinator threads). */
	pinned?: boolean;
	/** Owner-only or shared visibility inherited from the Core conversation row. */
	visibility?: ResourceVisibility;
	/** Run lifecycle status: "running" | "completed" | "failed" | "interrupted" |
	 * undefined. "interrupted" is stamped by Core's boot reconciliation on a run
	 * the node died in the middle of; it is TERMINAL, so "is this live?" checks
	 * must keep testing for "running" specifically. */
	runStatus?: string;
	title: string;
	updatedAt: number;
	/** Per-run worktree path, when a dedicated worktree was created (M1). */
	worktreePath?: string;
}
