// apps/desktop/src/lib/api/blueprint.ts
//
// Typed client for the Blueprint API (`/api/blueprint/*`) — the `public_mount` Core
// serves on behalf of the `ryu-blueprint` sidecar. Field names stay snake_case to
// match the sidecar's serde shapes exactly; the desktop never renames them, because
// the companion frame reads the same JSON on the other side of the bridge.
//
// ── Why this file is ONE function ─────────────────────────────────────────────────
//
// The same reason `reasoning.ts` and `social.ts` are: Blueprint has no desktop page.
// Its whole surface is the sandboxed companion, which reaches the sidecar through the
// single generic `blueprint.request` bridge verb, so a per-endpoint client here would
// be eleven functions with no callers — and would have to grow again for the
// round-two routes.
//
// What this module does own is the SECURITY BOUNDARY between a frame-chosen sub-path
// and a URL: the frame picks a path under `/api/blueprint`, and this decides whether
// that path is one, building the URL from a fixed base so the frame can never name a
// host. The check is duplicated from `@ryu/app-host/rpc`'s `asBlueprintRequestArg`
// deliberately — either layer alone would be the only thing standing between a
// sandboxed frame and the node's credentials.
//
// It is worth being concrete about who supplies the string here. A plan id is written
// by an AGENT (`plan_publish`) and appears mid-path in nearly every route
// (`/plans/:id/annotations`, `/plans/:id/steps/:step_id`). The companion concatenates
// it. So the untrusted-input path into this function is short, and it does not run
// through a human first.

import { type ApiTarget, request } from "./client.ts";

/** The mount Core serves the `ryu-blueprint` sidecar on. A CONSTANT, never a
 *  parameter: the whole point of the validation below is that the frame contributes
 *  the sub-path and nothing else. */
const BLUEPRINT_MOUNT = "/api/blueprint";

/** Methods the forwarder will issue. A closed set, mirroring `BLUEPRINT_METHODS` in
 *  `@ryu/app-host/rpc` — the sidecar's router serves no others. Three rather than the
 *  reasoning client's four: the plan surface is append-only (a revision is added by
 *  POSTing a new one, never edited in place), so there is no PUT to allow. */
const ALLOWED_METHODS = new Set(["GET", "POST", "DELETE"]);

/** A base that exists only to give `new URL()` something to resolve against. Never
 *  reaches a socket: only `pathname`/`search` are read back off the result, and the
 *  real base is applied later by `apiUrl`. */
const PARSE_BASE = "http://blueprint.invalid";

export type BlueprintMethod = "DELETE" | "GET" | "POST";

export interface BlueprintRequestInput {
	/** JSON body. Omit for GET/DELETE. */
	body?: unknown;
	/** Defaults to `"GET"`. */
	method?: BlueprintMethod;
	/** Path RELATIVE to `/api/blueprint`, leading slash included, query and all. */
	path: string;
}

/**
 * Validate a frame-supplied sub-path and return the full node path, or `null` when it
 * is not a path under the blueprint mount.
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
export function resolveBlueprintPath(path: unknown): string | null {
	if (typeof path !== "string" || !path.startsWith("/")) {
		return null;
	}
	if (path.startsWith("//") || path.includes("\\")) {
		return null;
	}
	let url: URL;
	try {
		url = new URL(`${BLUEPRINT_MOUNT}${path}`, PARSE_BASE);
	} catch {
		return null;
	}
	if (
		url.pathname !== BLUEPRINT_MOUNT &&
		!url.pathname.startsWith(`${BLUEPRINT_MOUNT}/`)
	) {
		return null;
	}
	return `${url.pathname}${url.search}`;
}

/**
 * Forward one companion call to the blueprint sidecar through Core.
 *
 * Resolves with the parsed JSON body and THROWS on any non-2xx (`request` raises a
 * typed `ApiError`), which is the contract the companion is written against: try/catch
 * plus an error banner, never a status check.
 */
export async function blueprintRequest(
	target: ApiTarget,
	input: BlueprintRequestInput
): Promise<unknown> {
	const path = resolveBlueprintPath(input.path);
	if (!path) {
		throw new Error(
			`Refusing to forward "${String(input.path)}" — a blueprint request path must be a sub-path of ${BLUEPRINT_MOUNT} beginning with "/" and containing no ".." segment.`
		);
	}
	const method = input.method ?? "GET";
	if (!ALLOWED_METHODS.has(method)) {
		throw new Error(
			`Refusing to forward a blueprint request with method "${method}".`
		);
	}
	return await request<unknown>(target, path, {
		method,
		body: input.body,
	});
}
