import { coreHeaders, loadConfig } from "./config.ts";
import { waitForReconnect } from "./reconnect-delay.ts";

interface Listener {
	key: string;
	receive: (value: string) => void;
}
const listeners = new Set<Listener>();
let owner: AbortController | null = null;
let activeTarget = "";

function target() {
	const url = `${loadConfig().coreBaseUrl}/api/preferences/stream`;
	const headers = coreHeaders({ Accept: "text/event-stream" });
	return { url, headers, identity: JSON.stringify([url, headers]) };
}

function dispatch(payload: string, signal: AbortSignal): void {
	let event: unknown;
	try {
		event = JSON.parse(payload);
	} catch {
		return;
	}
	if (
		!event ||
		typeof event !== "object" ||
		!("key" in event) ||
		!("value" in event) ||
		typeof event.value !== "string"
	) {
		return;
	}
	for (const listener of [...listeners]) {
		if (signal.aborted) {
			return;
		}
		if (listener.key !== event.key || !listeners.has(listener)) {
			continue;
		}
		try {
			listener.receive(event.value);
		} catch {
			/* One consumer cannot stop other preferences. */
		}
	}
}

async function consume(
	body: ReadableStream<Uint8Array>,
	signal: AbortSignal
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (!signal.aborted) {
			const { done, value } = await reader.read();
			if (done) {
				return;
			}
			buffer += decoder.decode(value, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline !== -1 && !signal.aborted) {
				const line = buffer.slice(0, newline).trimEnd();
				buffer = buffer.slice(newline + 1);
				if (line.startsWith("data:")) {
					dispatch(line.slice(5), signal);
				}
				newline = buffer.indexOf("\n");
			}
		}
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}

async function run(controller: AbortController): Promise<void> {
	while (!controller.signal.aborted) {
		const attempt = new AbortController();
		const abort = () => attempt.abort();
		controller.signal.addEventListener("abort", abort, { once: true });
		try {
			const next = target();
			activeTarget = next.identity;
			const response = await fetch(next.url, {
				headers: next.headers,
				signal: attempt.signal,
			});
			if (response.ok && response.body) {
				await consume(response.body, controller.signal);
			}
		} catch {
			/* A dropped connection retries while listeners remain. */
		} finally {
			attempt.abort();
			controller.signal.removeEventListener("abort", abort);
		}
		await waitForReconnect(controller.signal, 3000);
	}
}

/** Key-scoped listeners share one connection; the final unsubscribe closes it. */
export function subscribePreferenceChanges(
	key: string,
	receive: (value: string) => void
): () => void {
	const listener = { key, receive };
	listeners.add(listener);
	if (!owner || activeTarget !== target().identity) {
		owner?.abort();
		owner = new AbortController();
		void run(owner);
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			owner?.abort();
			owner = null;
			activeTarget = "";
		}
	};
}
