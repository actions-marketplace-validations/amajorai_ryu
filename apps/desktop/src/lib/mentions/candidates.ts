// Builds the grouped, filtered candidate list for the composer "@" menu, and
// applies a chosen mention back into the composer text. Pure functions — the
// menu component owns keyboard/dismiss state, ChatPage owns the data sources.
// See docs/rfc-mention-composer.md.

import {
	IconApps,
	IconDatabase,
	IconFolder,
	IconGitBranch,
	IconMessages,
	IconPlug,
	IconRobot,
	IconSparkles,
	IconUsers,
} from "@tabler/icons-react";
import type { MentionGroup, MentionItem, MentionSources } from "./types.ts";

const PATH_SEPARATOR = /[\\/]/;
/** The in-progress "@word" fragment at the cursor (after start or whitespace). */
const TRAILING_MENTION = /(?<=(?:^|\s))@\w*$/;
/** Last path segment of a folder path (the folder's display name). */
function basename(path: string): string {
	const parts = path.split(PATH_SEPARATOR).filter(Boolean);
	return parts.at(-1) ?? path;
}

/**
 * Group the mention sources into labelled sections, filtered by `query`
 * (case-insensitive substring). Order puts the two
 * targeting mentions (agents, teams) first, then plugins, then context refs.
 */
export function buildMentionGroups(
	sources: MentionSources,
	query: string
): MentionGroup[] {
	const q = query.trim().toLowerCase();
	const matches = (...fields: string[]) =>
		q === "" || fields.some((f) => f.toLowerCase().includes(q));
	const groups: MentionGroup[] = [];

	const add = (
		kind: MentionGroup["kind"],
		label: string,
		items: MentionItem[]
	) => {
		if (items.length > 0) {
			groups.push({ kind, label, items });
		}
	};

	add(
		"agent",
		"Agents",
		sources.agents
			.filter((a) => matches(a.name))
			.map((a) => ({ kind: "agent", id: a.id, label: a.name, icon: IconRobot }))
	);
	add(
		"team",
		"Teams",
		sources.teams
			.filter((t) => matches(t.name))
			.map((t) => ({ kind: "team", id: t.id, label: t.name, icon: IconUsers }))
	);
	add(
		"workflow",
		"Workflows",
		sources.workflows
			.filter((w) => matches(w.name))
			.map((w) => ({
				kind: "workflow",
				id: w.id,
				label: w.name,
				description: w.description ?? undefined,
				icon: IconGitBranch,
			}))
	);
	add(
		"chat",
		"Chats",
		sources.chats
			.filter((chat) => matches(chat.name, chat.description ?? ""))
			.map((chat) => ({
				kind: "chat",
				id: chat.id,
				label: chat.name,
				description: chat.description,
				icon: IconMessages,
			}))
	);
	add(
		"app",
		"Apps",
		(sources.apps ?? [])
			.filter((app) => matches(app.name, app.id, app.description ?? ""))
			.map((app) => ({
				kind: "app",
				id: app.id,
				label: app.name,
				description: app.description,
				icon: IconApps,
			}))
	);
	add(
		"plugin",
		"Plugins",
		sources.plugins
			.filter((p) => matches(p.name, p.id, p.description ?? ""))
			.map((p) => ({
				kind: "plugin",
				id: p.id,
				label: p.name,
				description: p.description,
				icon: IconPlug,
			}))
	);
	add(
		"skill",
		"Skills",
		sources.skills
			.filter((s) => matches(s.name))
			.map((s) => ({
				kind: "skill",
				id: s.id,
				label: s.name,
				icon: IconSparkles,
			}))
	);
	add(
		"mcp",
		"MCP",
		sources.mcp
			.filter((m) => matches(m.name))
			.map((m) => ({ kind: "mcp", id: m.id, label: m.name, icon: IconPlug }))
	);
	add(
		"space",
		"Spaces",
		sources.spaces
			.filter((s) => matches(s.name))
			.map((s) => ({
				kind: "space",
				id: s.id,
				label: s.name,
				icon: IconDatabase,
			}))
	);
	add(
		"folder",
		"Folders",
		sources.folders
			.filter((f) => matches(basename(f), f))
			.map((f) => ({
				kind: "folder",
				id: f,
				label: basename(f),
				description: f,
				icon: IconFolder,
			}))
	);

	return groups;
}

/** Flatten grouped candidates into a single ordered list for keyboard nav. */
export function flattenGroups(groups: MentionGroup[]): MentionItem[] {
	return groups.flatMap((g) => g.items);
}

/**
 * Apply a chosen mention back into the composer value by replacing the trailing
 * "@fragment" with an "@Label " token.
 */
export function applyMention(value: string, item: MentionItem): string {
	return value.replace(TRAILING_MENTION, `@${item.label} `);
}

/** Resolve chat tokens at send time so deleting a mention also removes its
 * context attachment. `selectedIds` disambiguates duplicate conversation titles;
 * manually typed exact titles still work when no menu/drop selection exists. */
export function resolveReferencedChatIds(
	content: string,
	chats: MentionSources["chats"],
	selectedIds: ReadonlySet<string>
): string[] {
	const mentioned = chats.filter((chat) => content.includes(`@${chat.name}`));
	const selected = mentioned.filter((chat) => selectedIds.has(chat.id));
	return (selected.length > 0 ? selected : mentioned).map((chat) => chat.id);
}
