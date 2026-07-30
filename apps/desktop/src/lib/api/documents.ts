// apps/desktop/src/lib/api/documents.ts
//
// Client for Core's `document.parse` facade (`/api/documents/parse*`) — the ONE
// document-extraction path. Composer attachments call it through
// `lib/composer/attachments.ts`; nothing else should re-implement extraction.
//
// Submit → poll, never one long request: the bound provider is a lazy sidecar whose
// activity guard drops when response headers arrive, so a single long-lived parse
// request can be reaped mid-flight. Core mirrors that contract, and so does this.

import {
	ApiError,
	type ApiTarget,
	apiUrl,
	identityHeaders,
	request,
} from "./client.ts";

/** What this node can extract text from, right now. */
export interface ParseCapability {
	/** Whether the bound provider reports itself usable (its library imports). */
	available: boolean;
	/** Extensions Core reads with no provider at all (`.txt`, `.md`, `.csv`, …). */
	builtinExtensions: string[];
	/** Union of the builtin floor and the bound provider's claimed formats. */
	extensions: string[];
	maxInputBytes: number;
	/** Native tools the provider needs but cannot find (poppler, tesseract, …). */
	missingDependencies: string[];
	/** Bound provider's plugin id, or null when only the builtin floor is active. */
	provider: string | null;
	providerName: string | null;
}

/** A parse in progress or finished. Mirrors Core's normalized job shape. */
export interface ParseResult {
	error?: string;
	jobId?: string;
	markdown?: string;
	missingDependencies?: string[];
	status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
	truncated?: boolean;
}

interface CapabilityWire {
	available?: boolean;
	builtin_extensions?: string[];
	extensions?: string[];
	max_input_bytes?: number;
	missing_dependencies?: string[];
	provider?: string | null;
	provider_name?: string | null;
}

interface JobWire {
	error?: string | null;
	job_id?: string | null;
	markdown?: string | null;
	missing_dependencies?: string[];
	status?: string;
	truncated?: boolean;
	via?: string;
}

function headersFor(target: ApiTarget): Record<string, string> {
	const headers: Record<string, string> = { ...identityHeaders() };
	if (target.token) {
		headers.authorization = `Bearer ${target.token}`;
	}
	return headers;
}

/** Read `error` out of a non-OK response body, falling back to the status. */
async function errorOf(res: Response): Promise<string> {
	try {
		const body = (await res.json()) as { error?: string };
		if (body.error) {
			return body.error;
		}
	} catch {
		// Body was not JSON — fall through to the status line.
	}
	return `Request failed (${res.status})`;
}

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

function normalizeJob(wire: JobWire): ParseResult {
	const status = (wire.status ?? "running") as ParseResult["status"];
	return {
		status,
		jobId: wire.job_id ?? undefined,
		markdown: wire.markdown ?? undefined,
		truncated: wire.truncated ?? false,
		error: wire.error ?? undefined,
		missingDependencies: wire.missing_dependencies ?? [],
	};
}

/** `GET /api/documents/parse/capability` — what the file picker should offer. */
export async function fetchParseCapability(
	target: ApiTarget,
	signal?: AbortSignal
): Promise<ParseCapability> {
	const res = await fetch(apiUrl(target, "/api/documents/parse/capability"), {
		headers: headersFor(target),
		signal,
	});
	if (!res.ok) {
		throw new Error(await errorOf(res));
	}
	const wire = (await res.json()) as CapabilityWire;
	return {
		available: wire.available ?? true,
		builtinExtensions: wire.builtin_extensions ?? [],
		extensions: wire.extensions ?? [],
		maxInputBytes: wire.max_input_bytes ?? 0,
		missingDependencies: wire.missing_dependencies ?? [],
		provider: wire.provider ?? null,
		providerName: wire.provider_name ?? null,
	};
}

/**
 * `POST /api/documents/parse` — submit a file for extraction.
 *
 * Resolves as soon as Core answers: `succeeded` (the builtin text floor read it
 * inline) or `queued`/`running` with a `jobId` to poll. A format nothing can read
 * REJECTS with the reason, which is the whole point — it is shown on the chip.
 */
export async function submitParse(
	target: ApiTarget,
	file: File,
	signal?: AbortSignal
): Promise<ParseResult> {
	const res = await fetch(apiUrl(target, "/api/documents/parse"), {
		method: "POST",
		headers: {
			...headersFor(target),
			"x-filename": encodeURIComponent(file.name),
			"content-type": file.type || "application/octet-stream",
		},
		body: file,
		signal,
	});
	if (!res.ok) {
		throw new Error(await errorOf(res));
	}
	return normalizeJob((await res.json()) as JobWire);
}

/** `GET /api/documents/parse/jobs/:id` — one poll. */
export async function fetchParseJob(
	target: ApiTarget,
	jobId: string,
	signal?: AbortSignal
): Promise<ParseResult> {
	const res = await fetch(
		apiUrl(target, `/api/documents/parse/jobs/${encodeURIComponent(jobId)}`),
		{ headers: headersFor(target), signal }
	);
	if (!res.ok) {
		throw new Error(await errorOf(res));
	}
	return normalizeJob((await res.json()) as JobWire);
}

/** Poll interval. Short enough to feel live, long enough not to spin the sidecar. */
const POLL_INTERVAL_MS = 900;

/**
 * How long to keep polling one parse before giving up.
 *
 * A ceiling, not a promise: a 600-page scanned PDF under OCR legitimately takes
 * minutes, and the provider enforces its own timeout. This exists so a job the
 * provider forgot about cannot leave a chip spinning for the rest of the session.
 */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Submit `file` and resolve when extraction finishes, failed or succeeded.
 *
 * Never throws for a parse that legitimately failed — that comes back as
 * `{ status: "failed", error }` so the caller can put the reason on the chip.
 * Throws only for transport/refusal, which the caller treats the same way.
 */
export async function parseDocument(
	target: ApiTarget,
	file: File,
	signal?: AbortSignal
): Promise<ParseResult> {
	const submitted = await submitParse(target, file, signal);
	if (TERMINAL_STATUSES.has(submitted.status)) {
		return submitted;
	}
	const jobId = submitted.jobId;
	if (!jobId) {
		return {
			status: "failed",
			error: "the parser accepted the file but returned no job id",
		};
	}

	const deadline = Date.now() + POLL_TIMEOUT_MS;
	let latest = submitted;
	while (Date.now() < deadline) {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(resolve, POLL_INTERVAL_MS);
			signal?.addEventListener(
				"abort",
				() => {
					clearTimeout(timer);
					reject(signal.reason ?? new Error("aborted"));
				},
				{ once: true }
			);
		});
		latest = await fetchParseJob(target, jobId, signal);
		if (TERMINAL_STATUSES.has(latest.status)) {
			return latest;
		}
	}
	return {
		status: "failed",
		error: "the parser did not finish in time",
		jobId,
	};
}

// ── Which backend extracts text (`document.parse` binding) ─────────────────────
//
// The extractor is a CAPABILITY, not a Rust trait: several apps can provide
// `document.parse` at once and Core resolves one with
// `user override > sole provider > declared default > lowest id`. These two
// routes are the thin, capability-filtered view of that (`/api/capabilities`
// serves every layer) plus the write that persists the override half — the SAME
// preference `PUT /api/capabilities/bindings` writes, so the two never disagree.
//
// Both are deliberately OUTSIDE the Spaces AppGate: the bound provider serves
// chat attachments too, so a node with Spaces turned off must still be able to
// see and pick a backend. Neither wakes a sidecar — this is pure metadata, safe
// to call on a settings mount.

/** One `document.parse` provider app. */
export interface ParseBackend {
	/** The manifest id (`com.ryu.markitdown`) — the value an override stores. */
	id: string;
	/** Whether it declares itself the default pick. */
	isDefault: boolean;
	name: string;
	version: string;
}

/** `GET /api/document-parse/backends` — installed backends and the bound one. */
export interface ParseBackendList {
	/** Installed but NOT enabled. Rendered as "enable it", never hidden: every
	 *  heavy backend ships opt-in, so hiding these leaves a node looking as if
	 *  nothing could ever read a PDF. */
	available: ParseBackend[];
	/** The provider serving parses right now, or null when only the floor is. */
	bound: string | null;
	/** Extensions Core reads with NO provider at all. This is why "no backend
	 *  installed" is not the same as "this node cannot read anything". */
	builtinExtensions: string[];
	/** True when the binding comes from an explicit override, not the auto-pick. */
	overridden: boolean;
	/** Every ENABLED candidate. */
	providers: ParseBackend[];
	/** Whether a pick is offered at all. False (with 2+ providers) means the
	 *  capability does not resolve and a picker would be a lie. */
	selectable: boolean;
}

interface ParseBackendWire {
	id: string;
	is_default?: boolean;
	name?: string;
	version?: string;
}

interface ParseBackendListWire {
	available?: ParseBackendWire[];
	bound?: string | null;
	builtin_extensions?: string[];
	overridden?: boolean;
	providers?: ParseBackendWire[];
	selectable?: boolean;
}

function toBackend(p: ParseBackendWire): ParseBackend {
	return {
		id: p.id,
		name: p.name ?? p.id,
		version: p.version ?? "",
		isDefault: p.is_default ?? false,
	};
}

/** `GET /api/document-parse/backends`. */
export async function fetchParseBackends(
	target: ApiTarget,
	signal?: AbortSignal
): Promise<ParseBackendList> {
	const wire = await request<ParseBackendListWire>(
		target,
		"/api/document-parse/backends",
		{ signal }
	);
	return {
		bound: wire.bound ?? null,
		overridden: wire.overridden ?? false,
		selectable: wire.selectable ?? false,
		providers: (wire.providers ?? []).map(toBackend),
		available: (wire.available ?? []).map(toBackend),
		builtinExtensions: wire.builtin_extensions ?? [],
	};
}

/**
 * `POST /api/document-parse/backend` — pick the backend, or pass `null` to clear
 * the override and fall back to the declared default.
 *
 * Documents already parsed by the previous backend KEEP their old text: swapping
 * does not silently re-extract a node's history. Re-parsing is the deliberate
 * second step (`reparseSpace` / `reparseDocument` in `./spaces.ts`).
 */
export async function setParseBackend(
	target: ApiTarget,
	backendId: string | null
): Promise<void> {
	await request(target, "/api/document-parse/backend", {
		method: "POST",
		body: { backend_id: backendId },
	});
}

/**
 * The reason a Core call was refused, preferring Core's own `{error}` body over
 * the generic `"<path> failed: <status>"` that `ApiError.message` carries.
 *
 * Without this, a refused backend swap — the 409 that names which enabled app the
 * change would leave unbound — reaches the user as
 * `/api/document-parse/backend failed: 409`. That is the opaque-failure class
 * this whole feature exists to end, reproduced in its own error path.
 */
export function describeApiRefusal(error: unknown): string | undefined {
	if (error instanceof ApiError) {
		return error.serverMessage ?? error.message;
	}
	return error instanceof Error ? error.message : undefined;
}

/**
 * Turn a stored `parse_error` (`"<code>: <message>"`) into a sentence that says
 * what to DO.
 *
 * The codes come from `ParseFailureReason::code()` in
 * `apps/core/src/document_parse.rs`, and the prefix is the point: `no_provider`
 * and `python_missing` are not "this file has no text", they are "this node
 * cannot read it yet, and here is what is missing". Rendering either as a bare
 * red dot recreates the exact bug the whole feature exists to kill.
 */
export function describeParseFailure(raw: string | null | undefined): string {
	if (!raw) {
		return "Extraction produced no text.";
	}
	const separator = raw.indexOf(":");
	const code = separator > 0 ? raw.slice(0, separator) : "";
	const detail = (separator > 0 ? raw.slice(separator + 1) : raw).trim();
	switch (code) {
		case "python_missing":
			return "Python not found on this node — using built-in text-only parsing. Install Python 3, then re-parse.";
		case "no_provider":
			return "No document parser is installed. Get one from the Store, then re-parse.";
		case "unsupported_format":
			return `Nothing on this node reads this format. ${detail}`.trim();
		case "provider_timeout":
			return "The parser ran out of time on this file. Try again.";
		case "too_large":
			return `Too large to read. ${detail}`.trim();
		case "provider_error":
			return detail || "The parser failed on this file.";
		default:
			return detail || raw;
	}
}

/** True when a stored `parse_error` means the HOST has no Python interpreter —
 *  the one failure that is about the machine, not the file, and so belongs in a
 *  space-level notice rather than only on one row. */
export function isPythonMissingFailure(
	raw: string | null | undefined
): boolean {
	return typeof raw === "string" && raw.startsWith("python_missing:");
}

/** Display label for a `parse_backend_id`. `"builtin"` is Core's own text floor,
 *  not an app, and saying so is what makes the swappable layer legible. */
export function parseBackendLabel(
	backendId: string | null | undefined,
	backends: ParseBackendList | null
): string | null {
	if (!backendId) {
		return null;
	}
	if (backendId === "builtin") {
		return "built-in";
	}
	const all = backends ? [...backends.providers, ...backends.available] : [];
	return all.find((b) => b.id === backendId)?.name ?? backendId;
}
