// apps/desktop/src/lib/artifacts.ts
//
// Detection of "rendered / canvas artifacts" in an assistant message's text.
//
// LobeChat-style: an agent frequently replies with a fenced ```html / ```svg /
// ```mermaid block (or a large standalone code block) that is far more useful
// rendered than read as raw markdown. This util scans the message stream's text
// parts for those blocks and returns a stable, deterministic Artifact[] the
// Cowork panel lists and the ArtifactRenderer draws in a sandboxed frame.
//
// This is DISTINCT from the worktree "Artifacts" concept in CoworkContextPanel
// (files the agent created on disk this run). These are ephemeral, in-message,
// renderable payloads — never touched by git.
//
// Everything here is pure + defensive: unknown/loose shapes, no throws, and ids
// derived from `messageId + fenced-block index` (never Math.random) so the same
// message always yields the same artifact ids across re-renders.

export type ArtifactKind =
	| "html"
	| "svg"
	| "mermaid"
	| "code"
	| "file"
	| "space"
	| "database";

/** An approval-style action an artifact carries, rendered with the app's own
 *  ToolApproval component (the same primitive the permission prompts use). The
 *  agent emits these when it needs a decision; choosing one sends the label back
 *  as a follow-up user turn. */
export interface ArtifactAction {
	id: string;
	label: string;
	tone?: "primary" | "secondary" | "ghost";
}

export interface Artifact {
	/** Optional approval-style choices rendered on the artifact surface. */
	actions?: ArtifactAction[];
	/** The raw block body (HTML/SVG source, mermaid DSL, code, markdown, JSON). */
	content: string;
	docId?: string;
	/** On-disk path, when the artifact is a real file (`code`/`file` kind). */
	filePath?: string;
	/** Stable id: `<messageId>-artifact-<blockIndex>` or a tool-call-derived id. */
	id: string;
	kind: ArtifactKind;
	/** The fenced language token, when the kind is `code` (e.g. "python"). */
	language?: string;
	/** MIME type of a created artifact, when known. */
	mime?: string;
	/** The message this artifact was extracted from. */
	sourceMessageId: string;
	/** Space + doc ids for an artifact persisted via `artifact.create`. */
	spaceId?: string;
	/** A short human label for the list row + panel tab. */
	title: string;
	/** Blob download URL for a created artifact (from `artifact.create`). */
	url?: string;
}

/** Loose view of a stream message — we only read `id`, `role`, and parts. The
 *  parts are kept as plain objects so BOTH text parts and tool parts (which carry
 *  `toolCallId`/`input`/`output`/`toolName`) fit the same array, and a caller's
 *  own part type (CoworkContextPanel's `StreamPart`) is structurally assignable.
 *  Field reads cast to a record defensively. */
interface ArtifactSourceMessage {
	id?: string;
	parts?: Array<object | null | undefined>;
	role?: string;
}

/** A part read as a loose record, or null when it isn't an object. */
function partRecord(
	part: object | null | undefined
): Record<string, unknown> | null {
	return part && typeof part === "object"
		? (part as Record<string, unknown>)
		: null;
}

// A fenced block: an opening ``` with an optional language token, then the body
// up to the next ```. Non-greedy body so consecutive blocks don't merge. Hoisted
// (never built in a loop) and `lastIndex` reset before each scan.
const FENCE_RE = /```([A-Za-z0-9_+#-]*)[ \t]*\r?\n([\s\S]*?)```/g;
const SVG_TAG_RE = /<svg[\s>]/i;
const HTML_DOC_RE = /^\s*(<!doctype html|<html[\s>])/i;
const TITLE_TAG_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const HEADING_RE = /^#{1,3}\s+(.+?)\s*#*$/m;
const WHITESPACE_RE = /\s+/g;
const TRAILING_WS_RE = /\s+$/;

// A `code` block only becomes an artifact when it is substantial — otherwise
// every one-line snippet would clutter the panel. HTML/SVG/mermaid are always
// artifacts (their whole value is being rendered), regardless of size.
const LARGE_CODE_MIN_LINES = 16;
const LARGE_CODE_MIN_CHARS = 800;

// Fenced languages that are prose/data, not "canvas" code worth a big viewer.
const NON_CODE_LANGS = new Set([
	"",
	"text",
	"txt",
	"plaintext",
	"markdown",
	"md",
	"mdx",
	"log",
	"diff",
	"patch",
]);

const MAX_TITLE_LEN = 48;

function clampTitle(value: string): string {
	const trimmed = value.replace(WHITESPACE_RE, " ").trim();
	if (trimmed.length <= MAX_TITLE_LEN) {
		return trimmed;
	}
	return `${trimmed.slice(0, MAX_TITLE_LEN - 1)}…`;
}

/** Concatenate a message's text parts into one scannable string. */
function messageText(message: ArtifactSourceMessage): string {
	const parts = message.parts;
	if (!Array.isArray(parts)) {
		return "";
	}
	const chunks: string[] = [];
	for (const part of parts) {
		const record = partRecord(part);
		if (record && record.type === "text" && typeof record.text === "string") {
			chunks.push(record.text);
		}
	}
	return chunks.join("\n\n");
}

/** Map a fenced (lang, body) to a renderable kind, or null when it isn't one. */
function classifyBlock(lang: string, body: string): ArtifactKind | null {
	const normalized = lang.toLowerCase();
	if (normalized === "mermaid" || normalized === "mmd") {
		return "mermaid";
	}
	if (normalized === "svg") {
		return "svg";
	}
	if (normalized === "xml" && SVG_TAG_RE.test(body)) {
		return "svg";
	}
	if (normalized === "html" || normalized === "htm") {
		return "html";
	}
	if (normalized === "" && HTML_DOC_RE.test(body)) {
		return "html";
	}
	if (normalized === "" && SVG_TAG_RE.test(body)) {
		return "svg";
	}
	// A substantial code block becomes a viewable artifact.
	const isLarge =
		body.length >= LARGE_CODE_MIN_CHARS ||
		body.split("\n").length >= LARGE_CODE_MIN_LINES;
	if (isLarge && !NON_CODE_LANGS.has(normalized)) {
		return "code";
	}
	return null;
}

function htmlTitle(body: string): string {
	const titleMatch = TITLE_TAG_RE.exec(body);
	if (titleMatch?.[1]) {
		return clampTitle(titleMatch[1]);
	}
	const headingMatch = HEADING_RE.exec(body);
	if (headingMatch?.[1]) {
		return clampTitle(headingMatch[1]);
	}
	return "Web page";
}

function mermaidTitle(body: string): string {
	const firstLine = body.trim().split("\n")[0]?.trim() ?? "";
	const keyword = firstLine.split(WHITESPACE_RE)[0]?.toLowerCase() ?? "";
	if (keyword.startsWith("sequence")) {
		return "Sequence diagram";
	}
	if (keyword.startsWith("class")) {
		return "Class diagram";
	}
	if (keyword.startsWith("state")) {
		return "State diagram";
	}
	if (keyword.startsWith("gantt")) {
		return "Gantt chart";
	}
	if (keyword.startsWith("pie")) {
		return "Pie chart";
	}
	if (keyword.startsWith("erdiagram") || keyword.startsWith("er")) {
		return "ER diagram";
	}
	return "Diagram";
}

function codeTitle(lang: string): string {
	if (!lang) {
		return "Code";
	}
	const pretty = lang.charAt(0).toUpperCase() + lang.slice(1);
	return `${pretty} snippet`;
}

function titleFor(kind: ArtifactKind, lang: string, body: string): string {
	if (kind === "html") {
		return htmlTitle(body);
	}
	if (kind === "svg") {
		return "Vector image";
	}
	if (kind === "mermaid") {
		return mermaidTitle(body);
	}
	if (kind === "database") {
		return "Database";
	}
	if (kind === "space") {
		return "Space document";
	}
	if (kind === "file") {
		return lang ? codeTitle(lang) : "File";
	}
	return codeTitle(lang.toLowerCase());
}

/** Extract every renderable artifact from one message's text (in order). */
function artifactsFromMessage(
	message: ArtifactSourceMessage,
	fallbackId: string
): Artifact[] {
	const text = messageText(message);
	if (!text.includes("```")) {
		return [];
	}
	const sourceMessageId =
		typeof message.id === "string" && message.id ? message.id : fallbackId;
	const found: Artifact[] = [];
	let blockIndex = 0;
	for (const match of text.matchAll(FENCE_RE)) {
		const lang = match[1] ?? "";
		const body = match[2] ?? "";
		const kind = body.trim() ? classifyBlock(lang, body) : null;
		if (kind) {
			found.push({
				id: `${sourceMessageId}-artifact-${blockIndex}`,
				kind,
				title: titleFor(kind, lang, body),
				content: body.replace(TRAILING_WS_RE, ""),
				language: kind === "code" ? lang.toLowerCase() || undefined : undefined,
				sourceMessageId,
			});
		}
		blockIndex += 1;
	}
	return found;
}

/** A tool part whose type names the built-in artifact surface. */
function isArtifactToolPart(
	part: Record<string, unknown> | null | undefined
): boolean {
	if (!part) {
		return false;
	}
	return (
		part.type === "tool-artifact.render" ||
		part.type === "tool-artifact.create" ||
		(part.type === "dynamic-tool" &&
			(part.toolName === "artifact.render" ||
				part.toolName === "artifact.create"))
	);
}

/**
 * Scan the whole conversation for rendered/canvas artifacts. Only assistant (or
 * unlabelled) messages are considered — a user pasting HTML is input, not an
 * artifact to render. Returns them in stream order; ids are stable per message.
 *
 * Two sources feed it: fenced blocks in the message text (html/svg/mermaid/code)
 * and the agent's own artifact TOOL parts (`artifact.render` input /
 * `artifact.create` result), so a file/page/space/database the agent minted
 * shows up in the cowork panel's Rendered artifacts list too.
 */
export function extractArtifacts(
	messages: readonly ArtifactSourceMessage[]
): Artifact[] {
	const all: Artifact[] = [];
	for (const [i, message] of messages.entries()) {
		if (!message || message.role === "user") {
			continue;
		}
		const messageId =
			typeof message.id === "string" && message.id ? message.id : `msg-${i}`;
		const fromMessage = artifactsFromMessage(message, messageId);
		for (const artifact of fromMessage) {
			all.push(artifact);
		}
		if (Array.isArray(message.parts)) {
			for (const part of message.parts) {
				const record = partRecord(part);
				if (!(record && isArtifactToolPart(record))) {
					continue;
				}
				const toolName =
					typeof record.toolName === "string"
						? record.toolName
						: typeof record.type === "string"
							? record.type.slice("tool-".length)
							: "";
				const id = artifactIdFromToolCall(
					typeof record.toolCallId === "string" ? record.toolCallId : undefined
				);
				const input = record.input as Record<string, unknown> | undefined;
				const output = record.output as Record<string, unknown> | undefined;
				if (toolName === "artifact.create") {
					// The create RESULT carries url/mime/ids (title lived in the input).
					const mime =
						typeof output?.mime === "string" ? output.mime : undefined;
					const url = typeof output?.url === "string" ? output.url : undefined;
					if (!url) {
						continue;
					}
					all.push(
						artifactFromPayload(
							{
								title:
									typeof input?.title === "string" ? input.title : undefined,
								mime,
								url,
								spaceId:
									typeof output?.space_id === "string"
										? output.space_id
										: undefined,
								docId: typeof output?.id === "string" ? output.id : undefined,
							},
							id,
							messageId
						)
					);
					continue;
				}
				const nested =
					(input?.artifact as ArtifactPayload | undefined) ??
					(input as ArtifactPayload | undefined);
				if (nested && typeof nested === "object") {
					all.push(artifactFromPayload(nested, id, messageId));
				}
			}
		}
	}
	return all;
}

// ── Agent-provided artifacts (artifact.render / artifact.create) ────────────
//
// These arrive as a structured tool payload rather than being mined out of
// message text. The desktop still normalizes them into the same `Artifact` shape
// so every surface (inline card, dock tab, window tab) renders one model.

const KNOWN_KINDS = new Set<ArtifactKind>([
	"html",
	"svg",
	"mermaid",
	"code",
	"file",
	"space",
	"database",
]);

/** Map a MIME type onto the artifact kind it best renders as. Unknown types
 *  (pdf, docx, png, …) fall back to `file` — a download/open card. */
export function artifactKindFromMime(mime: string | undefined): ArtifactKind {
	if (!mime) {
		return "file";
	}
	const normalized = mime.toLowerCase();
	if (normalized.includes("html")) {
		return "html";
	}
	if (normalized.includes("svg")) {
		return "svg";
	}
	if (normalized.includes("csv") || normalized.includes("json")) {
		return "database";
	}
	if (
		normalized.includes("markdown") ||
		normalized === "text/md" ||
		normalized === "text/x-markdown"
	) {
		return "space";
	}
	if (
		normalized.startsWith("text/") ||
		normalized.includes("javascript") ||
		normalized.includes("typescript") ||
		normalized.includes("rust") ||
		normalized.includes("python")
	) {
		return "code";
	}
	return "file";
}

/** A stable id from a tool-call identity (never `Math.random`), so the same
 *  artifact re-derives the same id across re-renders. */
export function artifactIdFromToolCall(toolCallId: string | undefined): string {
	const base = toolCallId?.trim() ? toolCallId : "artifact";
	return `artifact-${base}`;
}

/** The loose payload an agent sends through `artifact.render` (or that the
 *  desktop reads out of an `artifact.create` result). Every field optional so a
 *  malformed payload degrades to a "code" card instead of throwing. */
export interface ArtifactPayload {
	actions?: ArtifactAction[];
	content?: unknown;
	docId?: string;
	filePath?: string;
	kind?: unknown;
	language?: string;
	mime?: string;
	spaceId?: string;
	title?: unknown;
	url?: string;
}

/**
 * Normalize an agent-provided artifact payload into a desktop {@link Artifact}.
 * Defensive by design: unknown kinds collapse to `code`, missing content is the
 * empty string (a `url`-carrying created artifact fills it by fetch), and the
 * title falls back to the kind's default label.
 */
export function artifactFromPayload(
	payload: ArtifactPayload | null | undefined,
	id: string,
	sourceMessageId = "tool"
): Artifact {
	const content = typeof payload?.content === "string" ? payload.content : "";
	const declared =
		typeof payload?.kind === "string"
			? (payload.kind.toLowerCase() as ArtifactKind)
			: undefined;
	const kind: ArtifactKind =
		declared && KNOWN_KINDS.has(declared)
			? declared
			: artifactKindFromMime(payload?.mime);
	const title =
		typeof payload?.title === "string" && payload.title.trim()
			? clampTitle(payload.title)
			: titleFor(kind, payload?.language ?? "", content) || "Artifact";
	return {
		id,
		sourceMessageId,
		kind,
		title,
		content,
		language: payload?.language,
		filePath: payload?.filePath,
		url: payload?.url,
		mime: payload?.mime,
		spaceId: payload?.spaceId,
		docId: payload?.docId,
		actions: payload?.actions,
	};
}

// ── Tabular (`database`) parsing ───────────────────────────────────────────────

export interface DatabaseTable {
	columns: string[];
	rows: string[][];
}

const CSV_CELL_SPLIT = /,(?=(?:[^"]*"[^"]*")*[^"]*$)/;
const CSV_ROW_SPLIT = /\r?\n/;

function csvRows(text: string): string[][] {
	return text
		.split(CSV_ROW_SPLIT)
		.filter((line) => line.trim().length > 0)
		.map((line) =>
			line.split(CSV_CELL_SPLIT).map((cell) => {
				const trimmed = cell.trim();
				if (
					trimmed.length >= 2 &&
					trimmed.startsWith('"') &&
					trimmed.endsWith('"')
				) {
					return trimmed.slice(1, -1).replaceAll('""', '"');
				}
				return trimmed;
			})
		);
}

/**
 * Parse a `database` artifact's content into a table. Accepts JSON (an array of
 * row objects, or `{ columns, rows }`), or CSV. Returns null when the content
 * isn't tabular — the caller falls back to a code view.
 */
export function parseTabularContent(content: string): DatabaseTable | null {
	if (!content.trim()) {
		return null;
	}
	if (content.trim().startsWith("[") || content.trim().startsWith("{")) {
		try {
			const parsed = JSON.parse(content) as unknown;
			if (Array.isArray(parsed)) {
				const rows: Record<string, unknown>[] = parsed.filter(
					(v): v is Record<string, unknown> =>
						typeof v === "object" && v !== null && !Array.isArray(v)
				);
				if (rows.length === 0) {
					return null;
				}
				const columns = Array.from(
					new Set(rows.flatMap((row) => Object.keys(row)))
				);
				return {
					columns,
					rows: rows.map((row) =>
						columns.map((col) =>
							row[col] === null || row[col] === undefined
								? ""
								: typeof row[col] === "object"
									? JSON.stringify(row[col])
									: String(row[col])
						)
					),
				};
			}
			if (
				typeof parsed === "object" &&
				parsed !== null &&
				!Array.isArray(parsed)
			) {
				const obj = parsed as {
					columns?: unknown;
					rows?: unknown;
				};
				if (
					Array.isArray(obj.columns) &&
					obj.columns.every((c) => typeof c === "string") &&
					Array.isArray(obj.rows)
				) {
					return {
						columns: obj.columns as string[],
						rows: obj.rows
							.map((row) =>
								Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []
							)
							.filter((row) => row.length > 0),
					};
				}
			}
			return null;
		} catch {
			return null;
		}
	}
	const rows = csvRows(content);
	if (rows.length < 2) {
		return null;
	}
	return { columns: rows[0] ?? [], rows: rows.slice(1) };
}
