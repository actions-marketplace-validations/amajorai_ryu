// Generic main-process client for Core's key-value preference store. A key-scoped
// version of `services/voice.ts`: one-shot read plus an SSE subscription to
// `/api/preferences/stream` filtered to a single key. Used for the island agent
// routing (`island-agents`) and speak-replies (`island-tts`) prefs the desktop
// writes; the blob stays an opaque JSON string here, parsed by the matching
// `shared/*.ts` (no `@ryu/ui` dep, the main process externalizes workspace deps).

import { coreHeaders, loadConfig } from "./config.ts";
import { withResponseDeadline } from "./response-deadline.ts";

/** Timeout for a one-shot preference read. */
const GET_TIMEOUT_MS = 5000;

/** Write a preference value (raw JSON) by key. Returns success; never throws. */
export async function setPreferenceRaw(
	key: string,
	value: string
): Promise<boolean> {
	const { coreBaseUrl } = loadConfig();
	const readIdentity = JSON.stringify([
		`${coreBaseUrl}/api/preferences/${key}`,
		coreHeaders(),
	]);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), GET_TIMEOUT_MS);
	try {
		const resp = await fetch(`${coreBaseUrl}/api/preferences/${key}`, {
			method: "PUT",
			headers: coreHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({ value }),
			signal: controller.signal,
		});
		return resp.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
		controller.abort();
		pendingReads.delete(readIdentity);
	}
}

const pendingReads = new Map<string, Promise<string | null>>();

/** Share concurrent reads only; completed results are never cached. */
export async function getPreferenceRaw(key: string): Promise<string | null> {
	const url = `${loadConfig().coreBaseUrl}/api/preferences/${key}`;
	const headers = coreHeaders();
	const identity = JSON.stringify([url, headers]);
	const pending = pendingReads.get(identity);
	if (pending) {
		return pending;
	}
	const request = withResponseDeadline(
		url,
		{ headers },
		GET_TIMEOUT_MS,
		async (response) => {
			if (!response.ok) {
				return null;
			}
			const data = (await response.json()) as { value?: unknown };
			return typeof data.value === "string" ? data.value : null;
		}
	)
		.catch(() => null)
		.finally(() => {
			if (pendingReads.get(identity) === request) {
				pendingReads.delete(identity);
			}
		});
	pendingReads.set(identity, request);
	return request;
}

/** All keys share the same preference event connection. */
export { subscribePreferenceChanges } from "./preference-stream.ts";
