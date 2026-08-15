// apps/desktop/src/components/panels/CoworkContextPanel.tsx
//
// The "Cowork" context rail (Codex / Claude-cowork style). A read-only summary of
// what the current run is doing and touching, surfaced beside the transcript:
//
//   • Progress  — the agent's live plan (the latest `tool-TodoWrite` snapshot in
//                 the message stream), rendered as an in-place checklist.
//   • Artifacts — files the agent created this run (worktree diff, kind="added").
//   • Context   — the selected project folder + branch (workspace + git status).
//   • Changes   — the aggregate worktree diff with Apply / Open PR (DiffReviewPane).
//   • Sources   — connectors the run actually used, derived from its tool calls
//                 (web search, GitHub, Gmail, MCP servers, local files).
//   • Side chats— persisted `/btw` asides for this conversation (see Phase 2).
//
// Everything except Artifacts/Changes is derived from the live stream, so it is
// correct while a run unfolds but resets on reload (matching Codex's "Steps will
// show as the task unfolds." empty state). Artifacts/Changes come from Core's
// per-run worktree diff and survive reload.

import {
	ArrowDown01Icon,
	BrowserIcon,
	CheckmarkCircle02Icon,
	ComputerTerminal01Icon,
	DatabaseIcon,
	Delete01Icon,
	File01Icon,
	Flowchart01Icon,
	FolderOpenIcon,
	GitBranchIcon,
	Globe02Icon,
	Image02Icon,
	Link01Icon,
	Mail01Icon,
	MessageQuestionIcon,
	PlusSignIcon,
	Robot01Icon,
	Search01Icon,
	SourceCodeIcon,
	Target02Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { extractCitations } from "@ryu/blocks/desktop/agent-elements/utils/citations.ts";
import { cn } from "@ryu/ui/lib/utils";
import type { UIMessage } from "ai";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { openExternal } from "@/lib/tauri-bridge.ts";
import { DiffReviewPane } from "@/src/components/chat/DiffReviewPane.tsx";
import {
	SubagentAvatar,
	subagentName,
} from "@/src/components/panels/subagent-identity.tsx";
import {
	BouncyAccordion,
	type BouncyAccordionItem,
} from "@/src/components/ui/bouncy-accordion.tsx";
import {
	invalidateWorktreeDiff,
	useWorktreeDiff,
} from "@/src/hooks/useGitStatus.ts";
import type { BtwEntry } from "@/src/lib/api/btw.ts";
import { deleteBtw, listBtw } from "@/src/lib/api/btw.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import type { FileSummary } from "@/src/lib/api/git.ts";
import type { Artifact, ArtifactKind } from "@/src/lib/artifacts.ts";
import { extractArtifacts } from "@/src/lib/artifacts.ts";
import {
	firstString,
	PATH_KEYS,
	toolNameOf,
} from "@/src/lib/mission-control/turn-groups.ts";
import { compactAge } from "@/src/lib/time.ts";

// ── Message-stream shapes (loose, mirroring the AI SDK parts we read) ──────────

interface StreamPart {
	input?: unknown;
	output?: unknown;
	/** Present on tool parts. Nested (subagent) tools carry `<parentTaskId>:<id>`. */
	state?: string;
	toolCallId?: string;
	/** Present on `dynamic-tool` parts, where the name isn't in `type`. */
	toolName?: string;
	type?: string;
}

interface StreamMessage {
	parts?: StreamPart[];
	role?: string;
}

export interface CoworkPlanTodo {
	content: string;
	status: "pending" | "in_progress" | "completed";
}

export interface CoworkContextPanelProps {
	/** Live chat status from useChat, so the in-progress step can pulse. */
	chatStatus?: string;
	/**
	 * Extra accordion items rendered above the derived sections (Progress /
	 * Artifacts / …). The pinned-summary card injects its "Environment" section
	 * (pickers + git + commit & push) here so the whole panel is one accordion.
	 */
	leadingItems?: BouncyAccordionItem[];
	/** The conversation's message stream (AI SDK UIMessages). */
	messages: StreamMessage[];
	/**
	 * Open a detected rendered/canvas artifact (html/svg/mermaid/large code block)
	 * in the right panel's ArtifactRenderer.
	 */
	onOpenArtifact?: (artifact: Artifact) => void;
	/** Reopen a persisted side chat (the host shows it in the btw overlay). */
	onOpenSideChat?: (entry: BtwEntry) => void;
	/**
	 * Open a spawned subagent's transcript in the right panel. The host reads the
	 * subagent id and re-derives the live transcript from the message stream.
	 */
	onOpenSubagent?: (subagent: SubagentSummary) => void;
	/** The active conversation id (== worktree run id). Null on a fresh chat. */
	runId: string | null;
	/** Bumped by the host after a new `/btw` so the side-chats list refetches. */
	sideChatsRefreshKey?: number;
	/** Node target for the worktree-diff / git-status fetches. */
	target: ApiTarget;
}

// ── Derivations from the message stream ────────────────────────────────────────

const PLAN_PART_TYPE = "tool-TodoWrite";

function isToolPart(part: StreamPart): boolean {
	return (
		part.type === "dynamic-tool" ||
		(typeof part.type === "string" && part.type.startsWith("tool-"))
	);
}

/** The most recent plan snapshot (Core re-sends the full list each update). */
function extractLatestTodos(messages: StreamMessage[]): CoworkPlanTodo[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		const parts = messages[i]?.parts;
		if (!parts) {
			continue;
		}
		for (let j = parts.length - 1; j >= 0; j--) {
			const part = parts[j];
			if (part.type !== PLAN_PART_TYPE) {
				continue;
			}
			const input = part.input as { todos?: CoworkPlanTodo[] } | undefined;
			const todos = input?.todos;
			if (Array.isArray(todos) && todos.length > 0) {
				return todos;
			}
		}
	}
	return [];
}

/** One thing a source was actually used ON — a file, a link, a command. */
export interface SourceItem {
	/** Secondary line: the full path, the URL, the search root. */
	detail?: string;
	icon: IconSvgElement;
	/** Dedupe key within its group. */
	id: string;
	label: string;
	/** Set only for real links, which open in the OS browser. */
	url?: string;
}

export interface DerivedSource {
	icon: IconSvgElement;
	id: string;
	/** What the run touched through this source, first-seen order. */
	items: SourceItem[];
	label: string;
}

/** Beyond this the list stops being a summary; the rest collapse to "+N more". */
const MAX_SOURCE_ITEMS = 40;
const MAX_ITEM_CHARS = 160;
const FIRST_LINE_RE = /\r?\n[\s\S]*$/;

// Tool-name sets, not part types: a tool arrives either as `tool-<Name>` or as a
// `dynamic-tool` carrying `toolName`, and ACP bridges use their own names for
// the same operations. `toolNameOf` normalises both shapes.
const FILE_TOOLS = new Set([
	"Read",
	"Write",
	"Edit",
	"MultiEdit",
	"NotebookEdit",
	"NotebookRead",
	"apply_patch",
	"create_file",
	"str_replace_editor",
	"view_file",
]);
const SEARCH_TOOLS = new Set([
	"Grep",
	"Glob",
	"codebase_search",
	"file_search",
]);
const SHELL_TOOLS = new Set([
	"Bash",
	"BashOutput",
	"run_terminal_cmd",
	"shell",
]);
const WEB_TOOLS = new Set(["WebFetch", "WebSearch", "web_search"]);
const MCP_TOOL_RE = /^mcp__([^_]+(?:_[^_]+)*?)__(.*)$/;

function baseName(path: string): string {
	const segments = path.split(/[\\/]/).filter(Boolean);
	return segments.at(-1) ?? path;
}

function clampItem(text: string): string {
	const oneLine = text.replace(FIRST_LINE_RE, "").trim();
	return oneLine.length > MAX_ITEM_CHARS
		? `${oneLine.slice(0, MAX_ITEM_CHARS - 1).trimEnd()}…`
		: oneLine;
}

/**
 * Map a tool NAME to the connector/source it represents. Returns null for tools
 * that aren't a recognisable external source (so a run that only thinks/writes
 * shows just "Local files", not noise).
 */
function sourceForTool(tool: string): Omit<DerivedSource, "items"> | null {
	if (WEB_TOOLS.has(tool)) {
		return { id: "web", label: "Web search", icon: Globe02Icon };
	}
	if (tool === "cloning") {
		return { id: "github", label: "GitHub", icon: SourceCodeIcon };
	}
	if (FILE_TOOLS.has(tool) || SEARCH_TOOLS.has(tool) || SHELL_TOOLS.has(tool)) {
		return { id: "local", label: "Local files", icon: FolderOpenIcon };
	}
	// MCP tools carry the server name: mcp__<server>__<tool>.
	const mcpMatch = MCP_TOOL_RE.exec(tool);
	if (mcpMatch) {
		const server = mcpMatch[1].toLowerCase();
		if (server.includes("gmail") || server.includes("mail")) {
			return { id: "gmail", label: "Gmail", icon: Mail01Icon };
		}
		if (server.includes("github") || server.includes("git")) {
			return { id: "github", label: "GitHub", icon: SourceCodeIcon };
		}
		const pretty = server.charAt(0).toUpperCase() + server.slice(1);
		return { id: `mcp-${server}`, label: pretty, icon: Globe02Icon };
	}
	return null;
}

/**
 * The concrete thing one tool call touched, read out of its input. Every field
 * is best-effort: a call whose input hasn't streamed in yet (or whose bridge
 * names things differently) contributes no item rather than an empty row.
 */
function itemForTool(tool: string, part: StreamPart): SourceItem | null {
	if (FILE_TOOLS.has(tool)) {
		const path = firstString(part.input, PATH_KEYS);
		return path
			? {
					id: `file:${path}`,
					label: baseName(path),
					detail: path,
					icon: File01Icon,
				}
			: null;
	}
	if (SEARCH_TOOLS.has(tool)) {
		const pattern = firstString(part.input, ["pattern", "query", "glob"]);
		if (!pattern) {
			return null;
		}
		const where = firstString(part.input, PATH_KEYS);
		return {
			id: `search:${pattern}:${where ?? ""}`,
			label: clampItem(pattern),
			detail: where,
			icon: Search01Icon,
		};
	}
	if (SHELL_TOOLS.has(tool)) {
		const command = firstString(part.input, ["command", "cmd"]);
		return command
			? {
					id: `cmd:${command}`,
					label: clampItem(command),
					detail: firstString(part.input, ["description"]),
					icon: ComputerTerminal01Icon,
				}
			: null;
	}
	const url = firstString(part.input, ["url", "link", "uri"]);
	if (url) {
		return { id: `url:${url}`, label: url, url, icon: Link01Icon };
	}
	if (WEB_TOOLS.has(tool)) {
		const query = firstString(part.input, ["query", "q", "prompt"]);
		return query
			? {
					id: `query:${query}`,
					label: clampItem(query),
					detail: "Search query",
					icon: Search01Icon,
				}
			: null;
	}
	// An MCP call: name the verb, and show whatever argument identifies it.
	const verb = MCP_TOOL_RE.exec(tool)?.[2];
	if (!verb) {
		return null;
	}
	const argument = firstString(part.input, [
		"query",
		"name",
		"id",
		"subject",
		...PATH_KEYS,
	]);
	return {
		id: `mcp:${verb}:${argument ?? ""}`,
		label: verb.replace(/_/g, " "),
		detail: argument ? clampItem(argument) : undefined,
		icon: Globe02Icon,
	};
}

/**
 * Append an item to its group, keeping first-seen order. A repeat of the same id
 * is dropped — EXCEPT when the newcomer carries a real title for a link the
 * input-derived row could only name by its URL, which upgrades the row in place
 * (the fetch's own `<title>` beats `https://…` as a label).
 */
function pushItem(source: DerivedSource, item: SourceItem | null) {
	if (!item) {
		return;
	}
	const at = source.items.findIndex((existing) => existing.id === item.id);
	if (at === -1) {
		source.items.push(item);
		return;
	}
	const existing = source.items[at];
	if (existing.label === existing.url && item.label !== item.url) {
		source.items[at] = item;
	}
}

/**
 * Distinct sources used across the whole conversation, first-seen order, each
 * carrying the files / links / commands it was used on. Web results come from
 * `extractCitations` (the same derivation the transcript's citation chips use),
 * so a search's result links show up, not just the query that found them.
 */
export function extractSources(messages: StreamMessage[]): DerivedSource[] {
	const byId = new Map<string, DerivedSource>();
	const allParts: StreamPart[] = [];
	for (const message of messages) {
		if (!message.parts) {
			continue;
		}
		for (const part of message.parts) {
			allParts.push(part);
			if (!isToolPart(part)) {
				continue;
			}
			const tool = toolNameOf(part);
			const meta = sourceForTool(tool);
			if (!meta) {
				continue;
			}
			let source = byId.get(meta.id);
			if (!source) {
				source = { ...meta, items: [] };
				byId.set(meta.id, source);
			}
			pushItem(source, itemForTool(tool, part));
		}
	}

	const web = byId.get("web");
	if (web) {
		for (const citation of extractCitations(allParts)) {
			pushItem(web, {
				id: `url:${citation.url}`,
				label: citation.title,
				detail: citation.url,
				url: citation.url,
				icon: Link01Icon,
			});
		}
	}
	return [...byId.values()];
}

// ── Subagents (Task/Agent tool spawns) ─────────────────────────────────────────

// A run spawns a subagent via the `Task`/`Agent` tool (Claude Code / ACP). Each
// spawn is a tool part in the stream, and the tools the subagent itself ran are
// nested tool parts whose `toolCallId` is prefixed `<parentTaskId>:` — the same
// scheme the message list uses to fold nested rows under a subagent (see
// packages/blocks/.../message-list.tsx). We reconstruct each subagent's chat
// (prompt → its tool steps → its result) from those parts so it can be reopened
// in the right panel, with no extra endpoint.

const SUBAGENT_PART_TYPES = new Set(["tool-Task", "tool-Agent"]);
const TOOL_PREFIX_RE = /^tool-/;
const WHITESPACE_RE = /\s+/g;

export interface SubagentSummary {
	/**
	 * A live one-line description of what the subagent is doing right now (its
	 * latest tool step). Empty once done. Recomputed on every stream tick so the
	 * panel row updates live instead of only at the end.
	 */
	activity: string;
	/**
	 * The spawn ended in `output-error`. Distinct from a merely empty result: an
	 * errored Task usually carries no extractable output text either, so without
	 * this a failure and a clean silent finish are indistinguishable downstream —
	 * and the panel would tell the user a failed task "finished".
	 */
	errored: boolean;
	/** The Task/Agent tool call id — stable key + the transcript's identity. */
	id: string;
	/**
	 * The subagent kind (`subagent_type`), e.g. "code-reviewer". EMPTY when the
	 * spawn declared no type — which is every Claude-Code/Codex `Task` that omits
	 * it, and every `tool-Agent` spawn. Display-only, and every consumer must
	 * guard it: it used to default to the literal "Agent", which under a section
	 * already titled "Subagents" printed "Atlas Agent" and said nothing.
	 */
	label: string;
	/** A stable, friendly English name derived from `id`, e.g. "Atlas". */
	name: string;
	status: "running" | "done";
	/**
	 * How many tool steps of the subagent's own we could reconstruct. ZERO is the
	 * common case, not an error: child steps exist only where the agent emits the
	 * `details.ryuSteps` marker (today, the managed Pi agent), so a Claude-Code or
	 * Codex subagent over ACP reports none. Consumers use this to tell "nothing to
	 * show yet" apart from "this agent never narrates its steps".
	 */
	steps: number;
	/** The one-line task description, if any. */
	subtitle: string;
	/** A reconstructed read-only transcript for the right panel's MessageList. */
	transcript: UIMessage[];
}

/** Best-effort text extraction from a tool part's loose input/output shapes. */
function partText(value: unknown): string {
	if (value == null) {
		return "";
	}
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(partText).filter(Boolean).join("\n");
	}
	if (typeof value === "object") {
		const obj = value as Record<string, unknown>;
		if (typeof obj.text === "string") {
			return obj.text;
		}
		if (obj.content !== undefined) {
			return partText(obj.content);
		}
		if (obj.output !== undefined) {
			return partText(obj.output);
		}
		if (typeof obj.result === "string") {
			return obj.result;
		}
	}
	return "";
}

/** Drop the `<parentTaskId>:` prefix so a nested tool renders as a top-level row. */
function stripParentPrefix(part: StreamPart): StreamPart {
	const id = part.toolCallId;
	if (typeof id === "string" && id.includes(":")) {
		return { ...part, toolCallId: id.slice(id.indexOf(":") + 1) };
	}
	return part;
}

interface SubagentParts {
	/** The subagent's own tool calls, prefix-stripped and stream-ordered. */
	nested: Map<string, StreamPart[]>;
	/** The subagent's final answer text, concatenated from `tool-TaskOutput`. */
	output: Map<string, string>;
}

/** Split the stream's parts into per-subagent tool steps and output text. */
function groupSubagentParts(
	allParts: StreamPart[],
	taskIds: Set<string>
): SubagentParts {
	const nested = new Map<string, StreamPart[]>();
	const output = new Map<string, string>();
	for (const part of allParts) {
		const id = part.toolCallId;
		if (typeof id !== "string" || !id.includes(":")) {
			continue;
		}
		const parent = id.slice(0, id.indexOf(":"));
		if (!taskIds.has(parent)) {
			continue;
		}
		// `tool-TaskOutput` carries the subagent's final answer, not a tool step.
		if (part.type === "tool-TaskOutput") {
			const text = partText(part.output ?? part.input);
			if (text) {
				output.set(parent, (output.get(parent) ?? "") + text);
			}
			continue;
		}
		const list = nested.get(parent);
		if (list) {
			list.push(part);
		} else {
			nested.set(parent, [part]);
		}
	}
	return { nested, output };
}

/** Shorten a detail string for a single compact activity line. */
function shortenDetail(value: string): string {
	const trimmed = value.replace(WHITESPACE_RE, " ").trim();
	return trimmed.length > 40 ? `${trimmed.slice(0, 39)}…` : trimmed;
}

/** A live one-line label for the subagent's most recent tool step. */
function latestActivity(nested: StreamPart[]): string {
	if (nested.length === 0) {
		return "Starting…";
	}
	const last = nested.at(-1);
	if (!last) {
		return "Working…";
	}
	const name =
		typeof last.type === "string"
			? last.type.replace(TOOL_PREFIX_RE, "")
			: "tool";
	const input = last.input as Record<string, unknown> | undefined;
	const detail =
		input?.file_path ??
		input?.command ??
		input?.pattern ??
		input?.query ??
		input?.path ??
		input?.description;
	const detailStr =
		typeof detail === "string" && detail ? ` ${shortenDetail(detail)}` : "";
	return `${name}${detailStr}`;
}

/** Reconstruct one subagent's summary + read-only transcript from its parts. */
function toSubagentSummary(
	task: StreamPart,
	grouped: SubagentParts
): SubagentSummary {
	const id = task.toolCallId as string;
	const input = task.input as
		| { description?: string; prompt?: string; subagent_type?: string }
		| undefined;
	const subtitle = input?.description || "";
	const status: SubagentSummary["status"] =
		task.state === "output-available" || task.state === "output-error"
			? "done"
			: "running";
	const prompt = input?.prompt || subtitle || "Subagent task";
	const nested = (grouped.nested.get(id) ?? []).map(stripParentPrefix);
	const activity = status === "running" ? latestActivity(nested) : "";
	const outputText = grouped.output.get(id) || partText(task.output);

	const assistantParts: unknown[] = [...nested];
	if (outputText) {
		assistantParts.push({ type: "text", text: outputText });
	}
	const transcript = [
		{
			id: `${id}:prompt`,
			role: "user",
			parts: [{ type: "text", text: prompt }],
		},
		{ id: `${id}:result`, role: "assistant", parts: assistantParts },
	] as unknown as UIMessage[];

	return {
		id,
		name: subagentName(id),
		label: input?.subagent_type || "",
		subtitle,
		status,
		errored: task.state === "output-error",
		activity,
		steps: nested.length,
		transcript,
	};
}

/** Subagents spawned by the run, newest-relevant order preserved (stream order). */
export function extractSubagents(messages: StreamMessage[]): SubagentSummary[] {
	const allParts: StreamPart[] = [];
	for (const message of messages) {
		for (const part of message.parts ?? []) {
			allParts.push(part);
		}
	}

	const tasks = allParts.filter(
		(p) =>
			typeof p.type === "string" &&
			SUBAGENT_PART_TYPES.has(p.type) &&
			typeof p.toolCallId === "string"
	);
	if (tasks.length === 0) {
		return [];
	}

	const taskIds = new Set(tasks.map((t) => t.toolCallId as string));
	const grouped = groupSubagentParts(allParts, taskIds);
	return tasks.map((task) => toSubagentSummary(task, grouped));
}

function SubagentsList({
	subagents,
	onOpen,
}: {
	onOpen?: (subagent: SubagentSummary) => void;
	subagents: SubagentSummary[];
}) {
	return (
		<ul className="flex flex-col gap-0.5">
			{subagents.map((sub) => {
				// While running, the second line shows the live current tool step
				// (recomputed each stream tick); once done it falls back to the task
				// description so the row stays informative.
				const secondary =
					sub.status === "running" ? sub.activity : sub.subtitle;
				return (
					<li key={sub.id}>
						<button
							className={PANEL_ROW}
							onClick={() => onOpen?.(sub)}
							type="button"
						>
							<SubagentAvatar className="size-5 shrink-0" seed={sub.id} />
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="flex min-w-0 items-center gap-1.5">
									<span className="truncate text-foreground">{sub.name}</span>
									{/* Only a REAL `subagent_type` earns a chip. An untyped spawn
									    leaves `label` empty rather than printing "Agent" under a
									    section already titled "Subagents". */}
									{sub.label && (
										<span className="shrink-0 truncate text-[10px] text-muted-foreground/70">
											{sub.label}
										</span>
									)}
								</span>
								{secondary && (
									<span className="truncate text-muted-foreground">
										{secondary}
									</span>
								)}
							</span>
							{sub.status === "running" && (
								<span
									className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary"
									title="Running"
								/>
							)}
						</button>
					</li>
				);
			})}
		</ul>
	);
}

// ── Rendered / canvas artifacts (html · svg · mermaid · code) ─────────────────

// DISTINCT from the worktree "Artifacts" section above (files created on disk):
// these are renderable payloads found in the assistant's own message text
// (extractArtifacts), opened in a sandboxed ArtifactRenderer in the right panel.

const ARTIFACT_KIND_ICON: Record<ArtifactKind, IconSvgElement> = {
	html: BrowserIcon,
	svg: Image02Icon,
	mermaid: Flowchart01Icon,
	code: SourceCodeIcon,
	file: File01Icon,
	space: FolderOpenIcon,
	database: DatabaseIcon,
};

const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = {
	html: "HTML",
	svg: "SVG",
	mermaid: "Diagram",
	code: "Code",
	file: "File",
	space: "Space",
	database: "Database",
};

function RenderedArtifactsList({
	artifacts,
	onOpen,
}: {
	artifacts: Artifact[];
	onOpen?: (artifact: Artifact) => void;
}) {
	return (
		<ul className="flex flex-col gap-0.5">
			{artifacts.map((artifact) => (
				<li key={artifact.id}>
					<button
						className={PANEL_ROW}
						onClick={() => onOpen?.(artifact)}
						type="button"
					>
						<span aria-hidden className={PANEL_ROW_ICON}>
							<HugeiconsIcon
								className="size-3.5"
								icon={ARTIFACT_KIND_ICON[artifact.kind]}
							/>
						</span>
						<span className="min-w-0 flex-1 truncate text-foreground">
							{artifact.title}
						</span>
						<span className={PANEL_ROW_BADGE}>
							{ARTIFACT_KIND_LABEL[artifact.kind]}
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

// ── Accordion section helpers (same gooey BouncyAccordion as Getting started) ──

function SectionIcon({ icon }: { icon: IconSvgElement }) {
	return <HugeiconsIcon aria-hidden className="size-4" icon={icon} />;
}

// ── One row geometry for every subsection list ────────────────────────────────
//
// Sources, source items, Subagents, Rendered artifacts and Side chats were five
// hand-rolled copies of the same row, and they disagreed: a bare 14px glyph in
// one, a 24px avatar in another, so their labels started 10px apart; and every
// one of them set `text-sm` (14px) UNDER a section title of `text-xs` (12px), an
// inverted scale where the nested row shouted louder than its parent.
//
// PANEL_ROW_ICON is a fixed box, so a glyph row and an avatar row indent
// identically — that box, not the glyph inside it, is what sets the indent.
// PANEL_ROW_BADGE is the section title's own count pill, reused here so the
// trailing slot has ONE treatment instead of three (a pill, a bare span and an
// uppercase tracking chip).
const PANEL_ROW =
	"flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted/50";
const PANEL_ROW_STATIC =
	"flex w-full min-w-0 items-center gap-2 px-1.5 py-1 text-xs";
const PANEL_ROW_ICON =
	"grid size-5 shrink-0 place-items-center text-muted-foreground";
const PANEL_ROW_BADGE =
	"shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground tabular-nums";

function SectionTitle({ title, count }: { count?: number; title: string }) {
	return (
		<span className="flex items-center gap-2">
			<span className="font-medium text-foreground text-xs">{title}</span>
			{count !== undefined && count > 0 && (
				<span className={PANEL_ROW_BADGE}>{count}</span>
			)}
		</span>
	);
}

function EmptyHint({ children }: { children: ReactNode }) {
	return <p className="py-1 text-muted-foreground text-xs">{children}</p>;
}

// ── Progress checklist ─────────────────────────────────────────────────────────

function TodoStatusDot({
	status,
	pulse,
}: {
	pulse: boolean;
	status: CoworkPlanTodo["status"];
}) {
	if (status === "completed") {
		return (
			<HugeiconsIcon
				aria-hidden
				className="size-4 shrink-0 text-primary"
				icon={CheckmarkCircle02Icon}
			/>
		);
	}
	if (status === "in_progress") {
		return (
			<span
				className={cn(
					"mt-px flex size-3.5 shrink-0 items-center justify-center rounded-full border-2 border-primary",
					pulse && "animate-pulse"
				)}
			/>
		);
	}
	return (
		<span className="mt-px size-3.5 shrink-0 rounded-full border border-muted-foreground/40" />
	);
}

function ProgressSection({
	todos,
	chatStatus,
}: {
	chatStatus?: string;
	todos: CoworkPlanTodo[];
}) {
	const isStreaming = chatStatus === "streaming" || chatStatus === "submitted";
	if (todos.length === 0) {
		return <EmptyHint>Steps will show as the task unfolds.</EmptyHint>;
	}
	return (
		<ul className="flex flex-col gap-2">
			{todos.map((todo, idx) => (
				<li
					className="flex items-start gap-2"
					key={`${idx}-${todo.content.slice(0, 24)}`}
				>
					<TodoStatusDot
						pulse={isStreaming && todo.status === "in_progress"}
						status={todo.status}
					/>
					<span
						className={cn(
							"text-sm leading-snug",
							todo.status === "completed"
								? "text-muted-foreground line-through"
								: todo.status === "in_progress"
									? "text-foreground"
									: "text-muted-foreground"
						)}
					>
						{todo.content}
					</span>
				</li>
			))}
		</ul>
	);
}

// ── File row (artifacts) ───────────────────────────────────────────────────────

function FileRow({ file }: { file: FileSummary }) {
	const filename = file.path.split(/[\\/]/).at(-1) ?? file.path;
	return (
		<div className="flex items-center gap-2 py-1 text-sm" title={file.path}>
			<HugeiconsIcon
				aria-hidden
				className="size-3.5 shrink-0 text-muted-foreground"
				icon={File01Icon}
			/>
			<span className="min-w-0 flex-1 truncate text-foreground">
				{filename}
			</span>
		</div>
	);
}

// ── Sources (connectors + what each one touched) ───────────────────────────────

// Each connector row expands in place to the files it read/wrote, the links it
// fetched or found, and the commands it ran. A nested BouncyAccordion would put
// a second card (28px radii, `bg-card` on `bg-card`) inside the section, so this
// is the plain disclosure the rest of the rail uses — same row idiom as
// SubagentsList. The outer accordion measures its content with a ResizeObserver,
// so expanding a group grows the section; that also means the item list must not
// live in a fixed-height scroller (a pinned `offsetHeight` never grows), hence
// the `+N more` cap by count.

function SourceItemRow({ item }: { item: SourceItem }) {
	const body = (
		<>
			<span aria-hidden className={PANEL_ROW_ICON}>
				<HugeiconsIcon className="size-3.5" icon={item.icon} />
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-foreground">{item.label}</span>
				{item.detail && item.detail !== item.label && (
					<span className="truncate text-muted-foreground">{item.detail}</span>
				)}
			</span>
		</>
	);
	if (!item.url) {
		return (
			<li className={PANEL_ROW_STATIC} title={item.detail ?? item.label}>
				{body}
			</li>
		);
	}
	const url = item.url;
	return (
		<li>
			<button
				className={PANEL_ROW}
				onClick={() => {
					Promise.resolve(openExternal(url)).catch(() => {
						/* the link stays visible; nothing else to do */
					});
				}}
				title={url}
				type="button"
			>
				{body}
			</button>
		</li>
	);
}

function SourceGroup({ source }: { source: DerivedSource }) {
	const [open, setOpen] = useState(false);
	const contentId = useId();
	const shown = source.items.slice(0, MAX_SOURCE_ITEMS);
	const overflow = source.items.length - shown.length;

	if (source.items.length === 0) {
		return (
			<li className={PANEL_ROW_STATIC}>
				<span aria-hidden className={PANEL_ROW_ICON}>
					<HugeiconsIcon className="size-3.5" icon={source.icon} />
				</span>
				<span className="min-w-0 flex-1 truncate text-foreground">
					{source.label}
				</span>
			</li>
		);
	}

	return (
		<li>
			<button
				aria-controls={contentId}
				aria-expanded={open}
				className={PANEL_ROW}
				onClick={() => setOpen((prev) => !prev)}
				type="button"
			>
				<span aria-hidden className={PANEL_ROW_ICON}>
					<HugeiconsIcon className="size-3.5" icon={source.icon} />
				</span>
				<span className="min-w-0 flex-1 truncate text-foreground">
					{source.label}
				</span>
				<span className={PANEL_ROW_BADGE}>{source.items.length}</span>
				{/* Boxed like the parent row's chevron, so both end on one optical
				    column instead of the subsection's sitting 6px further in. */}
				<span aria-hidden className={PANEL_ROW_ICON}>
					<HugeiconsIcon
						className={cn(
							"size-3.5 transition-transform duration-200",
							open && "rotate-180"
						)}
						icon={ArrowDown01Icon}
					/>
				</span>
			</button>
			{open && (
				<ul
					className="mt-0.5 mb-1 ml-3 flex flex-col gap-0.5 border-border/60 border-l pl-2"
					id={contentId}
				>
					{shown.map((item) => (
						<SourceItemRow item={item} key={item.id} />
					))}
					{overflow > 0 && (
						<li className="px-1.5 py-1 text-muted-foreground text-xs">
							+{overflow} more
						</li>
					)}
				</ul>
			)}
		</li>
	);
}

function SourcesList({ sources }: { sources: DerivedSource[] }) {
	return (
		<ul className="flex flex-col gap-0.5">
			{sources.map((source) => (
				<SourceGroup key={source.id} source={source} />
			))}
		</ul>
	);
}

// ── Side chats (persisted /btw asides) ─────────────────────────────────────────

function SideChatsList({
	entries,
	onOpen,
	onDelete,
}: {
	entries: BtwEntry[];
	onDelete: (id: string) => void;
	onOpen?: (entry: BtwEntry) => void;
}) {
	return (
		<ul className="flex flex-col gap-0.5">
			{entries.map((entry) => (
				<li className="group/side flex items-center gap-1" key={entry.id}>
					<button
						className={cn(PANEL_ROW, "w-auto flex-1")}
						onClick={() => onOpen?.(entry)}
						type="button"
					>
						<span aria-hidden className={PANEL_ROW_ICON}>
							<HugeiconsIcon className="size-3.5" icon={MessageQuestionIcon} />
						</span>
						<span className="min-w-0 flex-1 truncate text-foreground">
							{entry.question}
						</span>
						<span className={PANEL_ROW_BADGE}>
							{compactAge(entry.created_at)}
						</span>
					</button>
					<button
						aria-label="Delete side chat"
						className="flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-accent group-hover/side:opacity-100"
						onClick={() => onDelete(entry.id)}
						type="button"
					>
						<HugeiconsIcon
							className="size-3 text-muted-foreground"
							icon={Delete01Icon}
						/>
					</button>
				</li>
			))}
		</ul>
	);
}

// ── Main panel ──────────────────────────────────────────────────────────────────

export function CoworkContextPanel({
	messages,
	runId,
	target,
	chatStatus,
	onOpenArtifact,
	onOpenSideChat,
	onOpenSubagent,
	sideChatsRefreshKey,
	leadingItems,
}: CoworkContextPanelProps) {
	const todos = useMemo(() => extractLatestTodos(messages), [messages]);
	const sources = useMemo(() => extractSources(messages), [messages]);
	const subagents = useMemo(() => extractSubagents(messages), [messages]);
	const artifacts = useMemo(() => extractArtifacts(messages), [messages]);

	// Created files come from the run's worktree diff, read live from Core through
	// the shared query every git surface reads — the panel no longer keeps its own
	// copy, which is how its file list could disagree with the Changes section
	// rendered directly underneath it.
	const diff = useWorktreeDiff(target, runId);
	const createdFiles: FileSummary[] = useMemo(
		() => diff.files.filter((f) => f.kind === "added"),
		[diff.files]
	);
	const diffHasChanges = diff.has_changes;
	// Side chats (persisted /btw asides) — lifted here so the section can hide
	// itself entirely when there are none.
	const [sideChats, setSideChats] = useState<BtwEntry[]>([]);

	const targetUrlRef = useRef(target);
	targetUrlRef.current = target;

	// A turn that just finished has written its files: invalidate so the diff is
	// re-read once, at the transition, instead of on a timer. `chatStatus` is a
	// TRIGGER, not something the body reads — it only flips on turn transitions
	// (submitted/streaming/ready), never per stream tick.
	useEffect(() => {
		if (runId) {
			invalidateWorktreeDiff(runId);
		}
	}, [runId, chatStatus]);

	useEffect(() => {
		if (!runId) {
			setSideChats([]);
			return;
		}
		const controller = new AbortController();
		listBtw(targetUrlRef.current, runId, controller.signal)
			.then((list) => {
				if (!controller.signal.aborted) {
					setSideChats(list);
				}
			})
			.catch(() => {
				/* treated as "no side chats" */
			});
		return () => controller.abort();
		// `sideChatsRefreshKey` is bumped by the composer after a `/btw` aside is
		// persisted; without it the new aside never appears until the run changes.
	}, [runId, sideChatsRefreshKey]);

	const handleDeleteSideChat = useCallback((id: string) => {
		setSideChats((prev) => prev.filter((e) => e.id !== id));
		deleteBtw(targetUrlRef.current, id).catch(() => {
			/* leave the optimistic removal; a refetch restores it if needed */
		});
	}, []);

	// One accordion for the whole panel. `leadingItems` (the pinned card's
	// Environment section) go first; each derived section is only added when it
	// has something to show, so empty sections disappear rather than showing a
	// hint. The project/branch/commit summary lives in leadingItems now, not
	// here (see PinnedSummaryPanel).
	const items: BouncyAccordionItem[] = [...(leadingItems ?? [])];

	if (todos.length > 0) {
		items.push({
			id: "progress",
			icon: <SectionIcon icon={Target02Icon} />,
			title: <SectionTitle count={todos.length} title="Progress" />,
			description: <ProgressSection chatStatus={chatStatus} todos={todos} />,
		});
	}

	if (createdFiles.length > 0) {
		items.push({
			id: "artifacts",
			icon: <SectionIcon icon={PlusSignIcon} />,
			title: <SectionTitle count={createdFiles.length} title="Artifacts" />,
			description: (
				<div className="flex flex-col">
					{createdFiles.map((file) => (
						<FileRow file={file} key={file.path} />
					))}
				</div>
			),
		});
	}

	if (runId && diffHasChanges) {
		items.push({
			id: "changes",
			icon: <SectionIcon icon={GitBranchIcon} />,
			title: <SectionTitle title="Changes" />,
			description: <DiffReviewPane runId={runId} target={target} />,
		});
	}

	if (artifacts.length > 0) {
		items.push({
			id: "rendered-artifacts",
			icon: <SectionIcon icon={BrowserIcon} />,
			title: (
				<SectionTitle count={artifacts.length} title="Rendered artifacts" />
			),
			description: (
				<RenderedArtifactsList artifacts={artifacts} onOpen={onOpenArtifact} />
			),
		});
	}

	if (sources.length > 0) {
		items.push({
			id: "sources",
			icon: <SectionIcon icon={Globe02Icon} />,
			title: <SectionTitle count={sources.length} title="Sources" />,
			description: <SourcesList sources={sources} />,
		});
	}

	if (subagents.length > 0) {
		items.push({
			id: "subagents",
			icon: <SectionIcon icon={Robot01Icon} />,
			title: <SectionTitle count={subagents.length} title="Subagents" />,
			description: (
				<SubagentsList onOpen={onOpenSubagent} subagents={subagents} />
			),
		});
	}

	if (runId && sideChats.length > 0) {
		items.push({
			id: "side-chats",
			icon: <SectionIcon icon={MessageQuestionIcon} />,
			title: <SectionTitle count={sideChats.length} title="Side chats" />,
			description: (
				<SideChatsList
					entries={sideChats}
					onDelete={handleDeleteSideChat}
					onOpen={onOpenSideChat}
				/>
			),
		});
	}

	if (items.length === 0) {
		return null;
	}

	return (
		<div className="h-full overflow-y-auto p-2">
			<BouncyAccordion
				// No `description` size override: every section body now declares its
				// own scale (the subsection rows are `text-xs`, DiffReviewPane and the
				// progress/file lists `text-sm`), so a panel-wide `text-sm` here would
				// only fight them.
				classNames={{
					item: "border border-border/60",
					title: "truncate",
				}}
				defaultValue={items[0]?.id ?? null}
				items={items}
			/>
		</div>
	);
}
