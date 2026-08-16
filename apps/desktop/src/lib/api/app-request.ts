import { type ApiTarget, request } from "./client.ts";

export interface AppRequestInput {
	body?: unknown;
	method?: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
	path: string;
}

const METHODS = new Set(["DELETE", "GET", "PATCH", "POST", "PUT"]);
const PARSE_BASE = "http://app.invalid";

export function resolveOwnAppPath(
	pluginId: string,
	path: unknown
): string | null {
	if (
		!pluginId ||
		typeof path !== "string" ||
		!path.startsWith("/") ||
		path.startsWith("//") ||
		path.includes("\\")
	) {
		return null;
	}
	const mount = `/api/ext/${pluginId}`;
	let url: URL;
	try {
		url = new URL(`${mount}${path}`, PARSE_BASE);
	} catch {
		return null;
	}
	if (url.pathname !== mount && !url.pathname.startsWith(`${mount}/`)) {
		return null;
	}
	return `${url.pathname}${url.search}`;
}

export async function ownAppRequest(
	target: ApiTarget,
	pluginId: string,
	input: AppRequestInput
): Promise<unknown> {
	const path = resolveOwnAppPath(pluginId, input.path);
	if (!path) {
		throw new Error("Refusing an app request outside its own sidecar mount.");
	}
	const method = input.method ?? "GET";
	if (!METHODS.has(method)) {
		throw new Error(`Refusing app request method ${method}.`);
	}
	return await request<unknown>(target, path, { method, body: input.body });
}
