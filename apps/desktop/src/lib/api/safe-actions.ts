import type { SafeActionsRequestPayload } from "@ryu/app-host/rpc";
import { type ApiTarget, request } from "./client.ts";

const SAFE_ACTIONS_MOUNT = "/api/tools/plans";
const PARSE_BASE = "http://safe-actions.invalid";
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);

/** Resolve a sandbox-selected sub-path beneath the fixed Core mount. Query
 * strings are refused: this v1 API has no query parameters, keeping the bridge's
 * route set explicit and preventing encoded traversal ambiguities. */
export function resolveSafeActionsPath(path: unknown): string | null {
	if (
		typeof path !== "string" ||
		!path.startsWith("/") ||
		path.startsWith("//") ||
		path.includes("\\") ||
		path.includes("?") ||
		path.includes("#")
	) {
		return null;
	}
	let url: URL;
	try {
		url = new URL(`${SAFE_ACTIONS_MOUNT}${path}`, PARSE_BASE);
	} catch {
		return null;
	}
	if (
		url.pathname !== SAFE_ACTIONS_MOUNT &&
		!url.pathname.startsWith(`${SAFE_ACTIONS_MOUNT}/`)
	) {
		return null;
	}
	return url.pathname;
}

export async function safeActionsRequest(
	target: ApiTarget,
	input: SafeActionsRequestPayload
): Promise<unknown> {
	const path = resolveSafeActionsPath(input.path);
	if (!path) {
		throw new Error("Refusing a request outside the Safe Actions API mount.");
	}
	const method = input.method ?? "GET";
	if (!ALLOWED_METHODS.has(method)) {
		throw new Error(`Refusing a Safe Actions request with method "${method}".`);
	}
	return await request<unknown>(target, path, {
		method,
		body: input.body,
	});
}
