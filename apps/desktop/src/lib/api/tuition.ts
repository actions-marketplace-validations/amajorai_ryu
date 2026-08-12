// apps/desktop/src/lib/api/tuition.ts
//
// Typed client for the Tuition API (`/api/tuition/*`) — the
// `public_mount` Core serves on behalf of the `ryu-tuition` sidecar. Field names
// stay snake_case to match the sidecar's serde shapes exactly; the desktop never
// renames them, because the companion frame reads the same JSON on the other side of
// the bridge.
//
// ── Why this file is ONE function ─────────────────────────────────────────────────
//
// The same reason `social.ts` is: tuition has no desktop page. Its whole surface is
// the sandboxed companion, which reaches the sidecar through the single generic
// `tuition.request` bridge verb, so a per-endpoint client here would be seven
// functions with no callers.
//
// What this module does own is the SECURITY BOUNDARY between a frame-chosen sub-path
// and a URL: the frame picks a path under `/api/tuition`, and this decides whether
// that path is one, building the URL from a fixed base so the frame can never name a
// host. The check is duplicated from `@ryu/app-host/rpc`'s `asTuitionRequestArg`
// deliberately — either layer alone would be the only thing standing between a
// sandboxed frame and the node's credentials.

import { type ApiTarget, request } from "./client.ts";

/** The mount Core serves the `ryu-tuition` sidecar on. A CONSTANT, never a
 *  parameter: the whole point of the validation below is that the frame contributes
 *  the sub-path and nothing else. */
const TUITION_MOUNT = "/api/tuition";

/** Methods the forwarder will issue. A closed set, mirroring `APP_CRUD_METHODS` in
 *  `@ryu/app-host/rpc` — the sidecar's router serves no others. */
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/** A base that exists only to give `new URL()` something to resolve against. Never
 *  reaches a socket: only `pathname`/`search` are read back off the result, and the
 *  real base is applied later by `apiUrl`. */
const PARSE_BASE = "http://tuition.invalid";

export type TuitionMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export interface TuitionRequestInput {
	/** JSON body. Omit for GET/DELETE. */
	body?: unknown;
	/** Defaults to `"GET"`. */
	method?: TuitionMethod;
	/** Path RELATIVE to `/api/tuition`, leading slash included, query and all. */
	path: string;
}

/**
 * Validate a frame-supplied sub-path and return the full node path, or `null` when it
 * is not a path under the tuition mount.
 *
 * Exported so it can be tested directly — this is the check that decides whether a
 * capability-gated forwarder is a forwarder or an SSRF hole, and it should not be
 * reachable only through a React component.
 *
 * Rejects, in order: a non-string or one not starting with `/` (which covers every
 * absolute URL and every bare-relative path); a protocol-relative `//evil/x`, which a
 * URL parser resolves as a different HOST; a backslash, which some parsers treat as a
 * separator and others do not — the gap a traversal slips through; and anything that
 * does not RESOLVE under the mount once the WHATWG parser has had its say. That last
 * one is the important clause: matching the parser's output rather than blocklisting
 * `..` is what stops `%2e%2e` and its variants, which decode into dot segments only
 * AFTER a literal check would have run.
 */
export function resolveTuitionPath(path: unknown): string | null {
	if (typeof path !== "string" || !path.startsWith("/")) {
		return null;
	}
	if (path.startsWith("//") || path.includes("\\")) {
		return null;
	}
	let url: URL;
	try {
		url = new URL(`${TUITION_MOUNT}${path}`, PARSE_BASE);
	} catch {
		return null;
	}
	if (
		url.pathname !== TUITION_MOUNT &&
		!url.pathname.startsWith(`${TUITION_MOUNT}/`)
	) {
		return null;
	}
	return `${url.pathname}${url.search}`;
}

/**
 * Forward one companion call to the tuition sidecar through Core.
 *
 * Resolves with the parsed JSON body and THROWS on any non-2xx (`request` raises a
 * typed `ApiError`), which is the contract the companion is written against: try/catch
 * plus an error banner, never a status check.
 */
export async function tuitionRequest(
	target: ApiTarget,
	input: TuitionRequestInput
): Promise<unknown> {
	const path = resolveTuitionPath(input.path);
	if (!path) {
		throw new Error(
			`Refusing to forward "${String(input.path)}" — a tuition request path must be a sub-path of ${TUITION_MOUNT} beginning with "/" and containing no ".." segment.`
		);
	}
	const method = input.method ?? "GET";
	if (!ALLOWED_METHODS.has(method)) {
		throw new Error(
			`Refusing to forward a tuition request with method "${method}".`
		);
	}
	return await request<unknown>(target, path, {
		method,
		body: input.body,
	});
}
