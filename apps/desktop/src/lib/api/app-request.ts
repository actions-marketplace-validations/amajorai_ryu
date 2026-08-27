import { ApiError, type ApiTarget, request } from "./client.ts";

export type AppRequestMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export interface AppRequestInput {
	body?: unknown;
	method?: AppRequestMethod;
	path: string;
	signal?: AbortSignal;
}

export interface MountedAppRequestPolicy {
	allowedMethods: ReadonlySet<AppRequestMethod>;
	invalidMethodMessage: (method: AppRequestMethod) => string;
	invalidPathMessage: (path: unknown) => string;
	mount: string;
}

export interface ValidatedMountedAppRequest {
	body?: unknown;
	method: AppRequestMethod;
	path: string;
	signal?: AbortSignal;
}

const METHODS: ReadonlySet<AppRequestMethod> = new Set([
	"DELETE",
	"GET",
	"PATCH",
	"POST",
	"PUT",
]);
const PARSE_BASE = "http://app.invalid";
const MOUNTED_APP_READ_RETRY_DELAYS_MS = [100, 300] as const;

/**
 * Resolve an untrusted sub-path beneath one fixed app mount.
 *
 * This is the desktop host's canonical containment check. The sandbox RPC layer
 * deliberately performs its own independent validation before a request reaches
 * this function; centralizing the host-side copy keeps every mounted app on the
 * same WHATWG URL semantics without weakening that two-layer boundary.
 */
export function resolveMountedAppPath(
	mount: string,
	path: unknown
): string | null {
	if (
		!mount?.startsWith("/") ||
		mount.startsWith("//") ||
		mount.includes("\\") ||
		typeof path !== "string" ||
		!path.startsWith("/") ||
		path.startsWith("//") ||
		path.includes("\\")
	) {
		return null;
	}
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

/** Validate the path and method once before issuing either JSON or custom I/O. */
export function validateMountedAppRequest(
	input: AppRequestInput,
	policy: MountedAppRequestPolicy
): ValidatedMountedAppRequest {
	const path = resolveMountedAppPath(policy.mount, input.path);
	if (!path) {
		throw new Error(policy.invalidPathMessage(input.path));
	}
	const method = input.method ?? "GET";
	if (!policy.allowedMethods.has(method)) {
		throw new Error(policy.invalidMethodMessage(method));
	}
	return {
		body: input.body,
		method,
		path,
		signal: input.signal,
	};
}

/** Forward a request that already passed the mounted-app path and method policy. */
export async function requestValidatedMountedApp(
	target: ApiTarget,
	validated: ValidatedMountedAppRequest
): Promise<unknown> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await request<unknown>(target, validated.path, {
				body: validated.body,
				method: validated.method,
				signal: validated.signal,
			});
		} catch (error) {
			const retryableRead =
				validated.method === "GET" &&
				error instanceof ApiError &&
				(error.status === 502 || error.status === 503);
			const delay = MOUNTED_APP_READ_RETRY_DELAYS_MS[attempt];
			if (!retryableRead || delay === undefined) {
				throw error;
			}
			await new Promise<void>((resolve) => setTimeout(resolve, delay));
		}
	}
}

/** Validate and forward one JSON request beneath a fixed mounted app path. */
export async function mountedAppRequest(
	target: ApiTarget,
	input: AppRequestInput,
	policy: MountedAppRequestPolicy
): Promise<unknown> {
	const validated = validateMountedAppRequest(input, policy);
	return await requestValidatedMountedApp(target, validated);
}

export function resolveOwnAppPath(
	pluginId: string,
	path: unknown
): string | null {
	if (!pluginId) {
		return null;
	}
	return resolveMountedAppPath(`/api/ext/${pluginId}`, path);
}

export async function ownAppRequest(
	target: ApiTarget,
	pluginId: string,
	input: AppRequestInput
): Promise<unknown> {
	if (!pluginId) {
		throw new Error("Refusing an app request outside its own sidecar mount.");
	}
	return await mountedAppRequest(target, input, {
		allowedMethods: METHODS,
		invalidMethodMessage: (method) => `Refusing app request method ${method}.`,
		invalidPathMessage: () =>
			"Refusing an app request outside its own sidecar mount.",
		mount: `/api/ext/${pluginId}`,
	});
}
