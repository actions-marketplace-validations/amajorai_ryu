// The typed model behind the composer's "@" mention system. A Mention is a typed
// reference the user drops into the chat composer — an agent, app, team, space,
// skill, MCP server, project folder, or installed plugin.

import type { ComponentType } from "react";

export type MentionKind =
	| "agent"
	| "app"
	| "chat"
	| "team"
	| "workflow"
	| "space"
	| "skill"
	| "mcp"
	| "folder"
	| "plugin";

/** A single, resolved mention candidate shown in the "@" menu. */
export interface MentionItem {
	/** Optional secondary line (e.g. a skill description or folder path). */
	description?: string;
	/** Icon for the row. */
	icon?: ComponentType<{ className?: string }>;
	/** Stable id: agent id, team id, space id, folder path, plugin id, … */
	id: string;
	kind: MentionKind;
	/** Display label — also the text inserted for entity mentions. */
	label: string;
}

/** The raw data the "@" menu draws its candidates from, per node. */
export interface MentionSources {
	agents: { id: string; name: string }[];
	/** Enabled desktop apps, discovered from Core's manifest registry. */
	apps: { id: string; name: string; description?: string }[];
	/** Saved conversations available as read-only context for the next turn. */
	chats: { id: string; name: string; description?: string }[];
	/** Absolute project folder paths (the label is the basename). */
	folders: string[];
	mcp: { id: string; name: string }[];
	/** Enabled non-app plugins, discovered from the same manifest registry. */
	plugins: { id: string; name: string; description?: string }[];
	skills: { id: string; name: string }[];
	spaces: { id: string; name: string }[];
	teams: { id: string; name: string }[];
	/** Chat-triggerable workflows (those with a root `Input` node, per Core). */
	workflows: { id: string; name: string; description?: string | null }[];
}

/** A labelled section of candidates in the menu (e.g. "Agents", "Plugins"). */
export interface MentionGroup {
	items: MentionItem[];
	kind: MentionKind;
	label: string;
}
