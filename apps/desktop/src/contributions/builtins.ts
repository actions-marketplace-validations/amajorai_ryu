// Seeds every built-in desktop page into the contribution registry, reproducing
// the exact routes (and first-match precedence) of the old `TabContent` if-else
// in `Layout.tsx`. This is the behavior-preserving half of #446: Layout renders
// via `RouteOutlet` (which calls `contributionRegistry.resolve`), so this file is
// the single place built-in routes are declared, and a plugin appends to the same
// registry instead of editing `Layout.tsx`.
//
// This module is the EXACT mirror of `Layout.tsx`'s former `TabContent`: every
// branch below maps one branch there, in the same exact-then-pattern order. The
// old chain interleaved exact and pattern branches, but every pattern is
// `$`-anchored and requires a deeper path segment than its exact sibling
// (`/agents` vs `/agents/.+/edit`, `/workflows` vs `/workflows/.+`, `/spaces` vs
// `/spaces/:id`, `/library` vs `/library/:section`, `/meetings` vs
// `/meetings/:id`), so no path matches both. Exacts therefore go in the O(1) map
// (checked first) and patterns in an ordered list — behavior-identical to the
// interleaved chain, only relative pattern order matters (and is preserved here).
//
// Deliberately NOT registered here (both are wired elsewhere so this stays a pure
// behavior-preserving mirror of the old chain):
//   - `/plugin/<id>` — registered per enabled companion by
//     `usePluginContributionRoutes`, so a disabled plugin's route disappears
//     (resolves null → blank) exactly as #446 item 4 wants.
//   - The scaffold "extras" the old `TabContent` never handled (`/graph`,
//     `/spaces/:id/graph`, `/profile`): the old chain returned `null` (blank) for those
//     paths, so mounting a real page here would be a regression, not a refactor. Left
//     for a separate PR. (`/skills/new` + `/skills/:id/edit` ARE now handled below — the
//     W7 frontend extraction landed the SKILL.md editor as the @ryu/skill-editor
//     companion; both previously resolved to blank.)
//
// No COMPANION ID is named here. This file used to carry twelve hardcoded aliases of the
// shape `createElement(PluginCompanionPage, { companionId: "app__<x>-companion" })`
// (activity, approvals/inbox, calendar, learning, mail, meetings, monitors, quests,
// skill-editor, timeline, webhooks, workflows). They duplicated the
// `usePluginContributionRoutes` seam AND kept resolving after their app was disabled
// — a companion id baked into shell code cannot know the app is gone. They are
// replaced by `CompanionAliasRoute` below: one generic catch-all that looks the
// companion up in the LIVE contributions feed, so an app that is not enabled
// contributes no companion, matches nothing, and its short path renders blank
// exactly as the seam intends. See `resolveCompanionAlias` for the lookup order.
//
// NOTE (PR-1 wiring): `seedBuiltinRoutes()` is called once at `Layout.tsx` module
// load (before first render) so the registry is populated before `RouteOutlet`
// resolves. Kept as JSX-free `createElement` calls so the file is `.ts` (no
// `.tsx`) and carries no JSX-runtime assumptions.

import { createElement } from "react";
import type { AttachedImage } from "@/components/agent-elements/input-bar.tsx";
import { WHITEBOARD_PLUGIN_ID } from "@/src/lib/whiteboard/app.ts";
import AgentEditPage from "@/src/pages/AgentEditPage.tsx";
import ChannelsPage from "@/src/pages/ChannelsPage.tsx";
import ChatPage from "@/src/pages/ChatPage.tsx";
import DownloadsPage from "@/src/pages/DownloadsPage.tsx";
import FileEditorPage from "@/src/pages/FileEditorPage.tsx";
import HomePage from "@/src/pages/HomePage.tsx";
import IdentitiesPage from "@/src/pages/IdentitiesPage.tsx";
import LibraryPage from "@/src/pages/LibraryPage.tsx";
import PluginCompanionPage, {
	CompanionUnavailable,
} from "@/src/pages/PluginCompanionPage.tsx";
import ReviewPage from "@/src/pages/ReviewPage.tsx";
import SettingsPage from "@/src/pages/SettingsPage.tsx";
import SpaceAppDocPage from "@/src/pages/SpaceAppDocPage.tsx";
import SpaceDatabaseEditorPage from "@/src/pages/SpaceDatabaseEditorPage.tsx";
import SpaceDatabaseRowPage from "@/src/pages/SpaceDatabaseRowPage.tsx";
import SpaceDocEditorPage from "@/src/pages/SpaceDocEditorPage.tsx";
import SpacesPage from "@/src/pages/SpacesPage.tsx";
import StorePage from "@/src/pages/StorePage.tsx";
import WorkflowsPage from "@/src/pages/WorkflowsPage.tsx";
import {
	APPROVALS_ALIAS,
	SKILL_EDITOR_ALIAS,
	topLevelAlias,
} from "./companion-alias.ts";
import { contributionRegistry, type RouteTab } from "./registry.ts";
import { useCompanionAlias } from "./use-companion-alias.ts";

// /channels/:id — manage a channel bot ("new" opens create mode).
const CHANNEL_DETAIL = /^\/channels\/[^/]+$/;
// /identities/profile/:profileId — manage identities with a profile focused.
const IDENTITY_PROFILE = /^\/identities\/profile\/[^/]+$/;
// A Notion-style markdown page inside a Space: /spaces/:spaceId/doc/:docId
const SPACE_DOC = /^\/spaces\/[^/]+\/doc\/[^/]+$/;
// A single database row's detail: /spaces/:spaceId/db/:databaseId/row/:rowId
const SPACE_DB_ROW = /^\/spaces\/[^/]+\/db\/[^/]+\/row\/[^/]+$/;
// A Space's data-grid database: /spaces/:spaceId/db/:databaseId
const SPACE_DB = /^\/spaces\/[^/]+\/db\/[^/]+$/;
// A Space's whiteboard (ported to the Whiteboard Ryu App): /spaces/:spaceId/wb/:documentId
const SPACE_WB = /^\/spaces\/[^/]+\/wb\/[^/]+$/;
// A Space document owned by a Ryu App: /spaces/:spaceId/app/:pluginId/:documentId
const SPACE_APP = /^\/spaces\/[^/]+\/app\/[^/]+\/[^/]+$/;
// /spaces/:spaceId — a single trailing segment (the doc/db patterns above are
// deeper), opening the Spaces page with that space pre-selected.
const SPACE_DETAIL = /^\/spaces\/[^/]+$/;
// /library/<section> — opens the unified Library on a specific collection tab.
const LIBRARY_SECTION = /^\/library\/([^/]+)$/;
// /workflows/:id (":id" is a workflow id, or "new" for an empty canvas). Single
// segment ([^/]+, not .+) so it does NOT swallow the two-segment builder path
// `/workflows/build/:id`.
const WORKFLOW_DETAIL = /^\/workflows\/[^/]+$/;
// /workflows/build/:id — the NL workflow builder for an existing workflow (the
// `/workflows/build` new-draft entry is an exact route). The builder is shell-
// only (see WorkflowsPage): host.runAgent's PermissionPreset never exposes the
// `workflow_builder__*` tools to the sandboxed canvas companion.
const WORKFLOW_BUILD = /^\/workflows\/build\/[^/]+$/;
// /meetings/:id — a specific meeting's transcript + notes.
const MEETING_DETAIL = /^\/meetings\/[^/]+$/;
// A deep-linked "open captured moment" into the Timeline: /timeline/:ts (ts in
// Unix µs). The command palette's "Search everything" opens this so the scrubber
// jumps straight to that moment; the ts is baked into the companion mount context
// as `window.ryu.context.focusTs` (the sandbox cannot receive the shell's
// `ryu:timeline-focus` window event the desktop page used).
const TIMELINE_FOCUS = /^\/timeline\/[^/]+$/;
// /agents/new/edit or /agents/:id/edit.
const AGENT_EDIT = /^\/agents\/.+\/edit$/;
// /skills/:id/edit — the SKILL.md editor for an existing skill (the `/skills/new`
// fresh-draft entry is an exact route). Single id segment ([^/]+), deeper than the
// `/skills` store exact, so no collision. The skill id is baked into the sandboxed
// @ryu/skill-editor companion as `window.ryu.context.skillId`.
const SKILL_EDIT = /^\/skills\/[^/]+\/edit$/;
// The legacy short-path catch-all: ANY single top-level segment the exact map and
// every pattern above declined (`/calendar`, `/timeline`, `/inbox`, …). Registered
// LAST so it can only ever see paths that used to fall through to `null`; it hands
// them to `CompanionAliasRoute`, which either finds a live companion in the
// contributions feed or renders blank — the same blank the fallthrough produced.
// Every pattern above needs at least two segments, so the two never compete.
const COMPANION_ALIAS = /^\/[^/]+$/;

/**
 * Mount whatever enabled app answers to `alias`, or nothing.
 *
 * The generic replacement for a hardcoded `companionId`. `mountContext` is forwarded
 * untouched so the context-carrying deep links (`/timeline/:ts` → `focusTs`,
 * `/meetings/:id` → `meetingId`, `/workflows/:id` → `workflowId`,
 * `/skills/:id/edit` → `skillId`) keep baking their parameter into the sandboxed
 * frame as `window.ryu.context.*` — losing that would be a silent regression, since
 * the sandbox cannot receive the window events the old desktop pages used.
 */
function CompanionAliasRoute({
	alias,
	mountContext,
}: {
	alias: string;
	mountContext?: unknown;
}) {
	const companionId = useCompanionAlias(alias);
	if (!companionId) {
		// NOT `null`. A blank tab is the one outcome worse than a hardcoded route:
		// most apps ship default-OFF, so on a fresh install the palette's "Inbox"
		// row, an OS notification click, the Timeline hotkey and the tray's
		// "Open Timeline" all reach this branch, and blank gives the user nothing to
		// read and nothing to do. Shares one definition with the by-id mount below so
		// the two cannot drift.
		return createElement(CompanionUnavailable);
	}
	return createElement(PluginCompanionPage, { companionId, mountContext });
}

/** Element factory for a route that mounts an app by short path rather than by id. */
const companionAlias = (alias: string, mountContext?: unknown) =>
	createElement(CompanionAliasRoute, { alias, mountContext });

// SKILL_EDITOR_ALIAS + APPROVALS_ALIAS — the two legacy paths no app can derive from
// its own id — moved to `companion-alias.ts`, because the surfaces that decide whether
// to OFFER these paths (the sidebar footer's Inbox tray, an OS notification's click
// target) need the same strings and must resolve them against the same feed. Both
// still name a PATH, never a companion id, so they blank out when their app is
// disabled — and both disappear the moment the owning manifest claims the path itself
// (a `sidebar_buttons[].target`-style route claim; see the manifest follow-up).

let seeded = false;

/** Register all built-in routes exactly once. Idempotent. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one-time flat registration of the built-in route table, mirroring the old tab router branch-for-branch.
export function seedBuiltinRoutes(): void {
	if (seeded) {
		return;
	}
	seeded = true;

	const exact = (path: string, render: (tab: RouteTab) => unknown) =>
		contributionRegistry.registerRoute({
			kind: "exact",
			path,
			render: render as never,
		});

	// ── Exact routes (matched first via the O(1) map) ─────────────────────────
	exact("/home", () => createElement(HomePage));
	exact("/chat", (tab) =>
		createElement(ChatPage, {
			initialAgent: tab.initialAgent,
			initialImages: tab.initialImages as AttachedImage[] | undefined,
			initialProject: tab.initialProject,
			initialPrompt: tab.initialPrompt,
			initialSubmit: tab.initialSubmit,
			tabConversationId: tab.conversationId,
		})
	);
	// Agents/Spaces/Workflows no longer have standalone list pages — they're
	// consolidated into the unified Library; the bare routes redirect there.
	exact("/agents", () =>
		createElement(LibraryPage, { initialSection: "agent" })
	);
	exact("/engines", () =>
		createElement(StorePage, { initialSection: "engines" })
	);
	exact("/store", () => createElement(StorePage));
	// The plugin catalog's two slices: companion-UI apps vs plain plugins.
	exact("/store/apps", () =>
		createElement(StorePage, { initialSection: "apps" })
	);
	exact("/store/plugins", () =>
		createElement(StorePage, { initialSection: "plugins" })
	);
	exact("/store/agents", () =>
		createElement(StorePage, { initialSection: "agents" })
	);
	exact("/store/workflows", () =>
		createElement(StorePage, { initialSection: "workflows" })
	);
	exact("/library", () => createElement(LibraryPage));
	// Channels/Identities: bare routes open the Library collection tab; manage
	// CRUD lives on `/channels/:id`, `/channels/new`, `/identities/new`, and
	// `/identities/profile/:profileId` (profiles are named strings, not UUIDs).
	exact("/channels", () =>
		createElement(LibraryPage, { initialSection: "channel" })
	);
	exact("/identities", () =>
		createElement(LibraryPage, { initialSection: "identity" })
	);
	exact("/identities/new", () =>
		createElement(IdentitiesPage, { initialNew: true })
	);
	exact("/models", () =>
		createElement(StorePage, { initialSection: "models" })
	);
	exact("/skills", () =>
		createElement(StorePage, { initialSection: "skills" })
	);
	// The SKILL.md authoring editor (fresh draft). Both `/skills/new` and the
	// `/skills/:id/edit` pattern route below mount whichever app answers to
	// SKILL_EDITOR_ALIAS; new-draft mode carries no mount context (the companion
	// detects the absent `window.ryu.context.skillId`).
	exact("/skills/new", () => companionAlias(SKILL_EDITOR_ALIAS));
	exact("/spaces", () =>
		createElement(LibraryPage, { initialSection: "space" })
	);
	// Tools moved from the Store to the Library — same bare route, new home. Kept as
	// `/tools` (not redirected to `/library/tools`) to match the other bare
	// collection routes (`/spaces`, `/workflows`) and so every existing sidebar
	// entry, palette command and deep link keeps working.
	exact("/tools", () =>
		createElement(LibraryPage, { initialSection: "tools" })
	);
	exact("/workflows", () =>
		createElement(LibraryPage, { initialSection: "workflow" })
	);
	exact("/review", () => createElement(ReviewPage));
	// Marketplace folded into the store: the legacy route opens the store.
	exact("/marketplace", () => createElement(StorePage));
	// The NL workflow builder (fresh draft). The visual canvas is the
	// @ryu/workflows companion (see the /workflows/:id pattern route below); the
	// builder is architecturally shell-only, so it keeps its own shell page.
	exact("/workflows/build", () =>
		createElement(WorkflowsPage, { initialWorkflowId: null })
	);
	// `/approvals` itself needs no entry — the catch-all derives it from the app's
	// companion id — but `/inbox` is the historic alias of the same surface, and no
	// convention can get there from "approvals".
	exact("/inbox", () => companionAlias(APPROVALS_ALIAS));
	exact("/downloads", () => createElement(DownloadsPage));
	exact("/settings", () => createElement(SettingsPage));
	// Apps + Extensions + Fleet all merged into the store's Installed section.
	exact("/extensions", () =>
		createElement(StorePage, { initialSection: "installed" })
	);
	exact("/apps", () =>
		createElement(StorePage, { initialSection: "installed" })
	);
	exact("/fleet", () =>
		createElement(StorePage, { initialSection: "installed" })
	);

	// ── Pattern routes (ordered; each `$`-anchored regex uses [^/]+ per segment,
	// so deeper paths only match their own pattern — relative order among them is
	// preserved to mirror the old chain exactly) ─
	const pattern = (
		test: RegExp | { startsWith: string },
		render: (tab: RouteTab, ctx: { onClose: () => void }) => unknown
	) =>
		contributionRegistry.registerRoute({
			kind: "pattern",
			test,
			render: render as never,
		});

	// /store/mcp and /store/mcp/q/<query> — open the store's MCP catalog,
	// optionally pre-filtered. The integrations.sh MCP hand-off deep-links here so
	// a directory entry lands on a real, installable registry match instead of an
	// external docs page (openTab strips `?`, so the query rides as a path segment).
	pattern(/^\/store\/mcp(?:\/q\/(.+))?$/, (tab) => {
		const match = tab.path.match(/^\/store\/mcp\/q\/(.+)$/);
		let query: string | undefined;
		if (match) {
			try {
				query = decodeURIComponent(match[1]);
			} catch {
				query = match[1];
			}
		}
		return createElement(StorePage, {
			initialSection: "mcp",
			initialQuery: query,
		});
	});
	// /library/<section> — open the Library on a specific collection tab.
	pattern(LIBRARY_SECTION, (tab) =>
		createElement(LibraryPage, { initialSection: tab.path.split("/")[2] })
	);
	// /channels/:id ("new" => create form) — channel-bot manage page.
	pattern(CHANNEL_DETAIL, (tab) => {
		const id = tab.path.split("/")[2];
		return createElement(ChannelsPage, {
			initialNew: id === "new",
			initialSelectedId: id === "new" ? null : id,
		});
	});
	// /identities/profile/:profileId — manage page focused on a profile.
	pattern(IDENTITY_PROFILE, (tab) => {
		let profileId = tab.path.split("/")[3] ?? "";
		try {
			profileId = decodeURIComponent(profileId);
		} catch {
			// keep raw segment
		}
		return createElement(IdentitiesPage, { initialProfileId: profileId });
	});
	// /spaces/:spaceId/doc/:docId
	pattern(SPACE_DOC, (tab) => {
		const segments = tab.path.split("/");
		return createElement(SpaceDocEditorPage, {
			documentId: segments[4],
			spaceId: segments[2],
		});
	});
	// /spaces/:spaceId/db/:databaseId/row/:rowId
	pattern(SPACE_DB_ROW, (tab) => {
		const segments = tab.path.split("/");
		return createElement(SpaceDatabaseRowPage, {
			databaseId: segments[4],
			rowId: segments[6],
			spaceId: segments[2],
		});
	});
	// /spaces/:spaceId/db/:databaseId
	pattern(SPACE_DB, (tab) => {
		const segments = tab.path.split("/");
		return createElement(SpaceDatabaseEditorPage, {
			databaseId: segments[4],
			spaceId: segments[2],
		});
	});
	// /spaces/:spaceId/wb/:documentId — a legacy whiteboard link mounts the
	// Whiteboard Ryu App's Companion (which owns the document) via SpaceAppDocPage.
	pattern(SPACE_WB, (tab) => {
		const segments = tab.path.split("/");
		return createElement(SpaceAppDocPage, {
			documentId: segments[4],
			pluginId: WHITEBOARD_PLUGIN_ID,
			spaceId: segments[2],
		});
	});
	// /spaces/:spaceId/app/:pluginId/:documentId — a Space doc owned by a Ryu App.
	pattern(SPACE_APP, (tab) => {
		const segments = tab.path.split("/");
		return createElement(SpaceAppDocPage, {
			documentId: segments[5],
			pluginId: segments[4],
			spaceId: segments[2],
		});
	});
	// /spaces/:spaceId — open Spaces with that space pre-selected.
	pattern(SPACE_DETAIL, (tab) =>
		createElement(SpacesPage, { initialSpaceId: tab.path.split("/")[2] })
	);
	// /file/<encoded abs path>
	pattern({ startsWith: "/file/" }, (tab) => {
		const filePath = decodeURIComponent(tab.path.slice("/file/".length));
		return createElement(FileEditorPage, { filePath });
	});
	// /workflows/build/:id — NL builder for an existing workflow (registered before
	// WORKFLOW_DETAIL for clarity; the two regexes are disjoint by segment count).
	pattern(WORKFLOW_BUILD, (tab) =>
		createElement(WorkflowsPage, { initialWorkflowId: tab.path.split("/")[3] })
	);
	// /workflows/:id ("new" => blank canvas) — the visual canvas belongs to whichever
	// app answers to `/workflows` (its own exact route above is the Library list, so
	// the alias is only ever used as a lookup key here). The deep-linked workflow id
	// is baked into the frame as `window.ryu.context.workflowId`.
	pattern(WORKFLOW_DETAIL, (tab) => {
		const workflowId = tab.path.split("/")[2];
		return companionAlias(
			topLevelAlias(tab.path),
			workflowId === "new" ? undefined : { workflowId }
		);
	});
	// /timeline/:ts — "open captured moment": mount the app that answers to `/timeline`
	// with the target timestamp (Unix µs) baked into the frame as
	// `window.ryu.context.focusTs`, so it scrubs straight to that moment (the desktop
	// page received this via the `ryu:timeline-focus` window event, which cannot cross
	// the sandbox). A non-numeric segment yields no focus context (harmless).
	pattern(TIMELINE_FOCUS, (tab) => {
		const focusTs = Number(tab.path.split("/")[2]);
		return companionAlias(
			topLevelAlias(tab.path),
			Number.isFinite(focusTs) ? { focusTs } : undefined
		);
	});
	// /meetings/:id — a specific meeting's detail (transcript + notes): mount the app
	// that answers to `/meetings` with the meeting id baked into the frame as
	// `window.ryu.context.meetingId` via the mount context (the desktop page received
	// it as a route prop, which cannot cross the sandbox).
	pattern(MEETING_DETAIL, (tab) =>
		companionAlias(topLevelAlias(tab.path), {
			meetingId: tab.path.split("/")[2],
		})
	);
	// /skills/:id/edit — the SKILL.md editor for an existing skill, with the skill id
	// baked into the frame as `window.ryu.context.skillId` (the desktop page received
	// it as a route prop, which cannot cross the sandbox). `/skills` belongs to the
	// skills store, not the editor, so this verb route names SKILL_EDITOR_ALIAS rather
	// than deriving the app from its own path — see that constant.
	pattern(SKILL_EDIT, (tab) =>
		companionAlias(SKILL_EDITOR_ALIAS, { skillId: tab.path.split("/")[2] })
	);
	// /agents/:id/edit (carries onClose from the render context)
	pattern(AGENT_EDIT, (tab, ctx) =>
		createElement(AgentEditPage, {
			agentIdProp: tab.path.split("/")[2],
			onClose: ctx.onClose,
		})
	);
	// The legacy short paths (`/calendar`, `/timeline`, `/inbox`, `/mail`, …), minted
	// from the contributions feed instead of a hardcoded table — registered LAST so
	// every shell route above still wins, and so this only ever sees paths that used
	// to fall through to blank. An app that is disabled contributes no companion, so
	// its short path resolves to nothing exactly as the `/plugin/<id>` seam intends.
	pattern(COMPANION_ALIAS, (tab) => companionAlias(tab.path));
}
