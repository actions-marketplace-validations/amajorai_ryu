export interface LocalNodeConfig {
	baseUrl: string;
	token: string | null;
}

export interface LocalNodeHealth {
	capabilities?: unknown;
	channel?: string;
	status: string;
	version?: string;
}

export interface LocalNodeChatMessage {
	content: string;
	role: "assistant" | "system" | "user";
}

export interface LocalNodeChatOptions {
	onDelta?: (text: string) => void;
	signal?: AbortSignal;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const MAX_ERROR_BODY_CHARS = 800;
const MAX_ASSISTANT_CHARS = 12_000;

function normalizedHostname(hostname: string): string {
	return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

export function isLoopbackNodeUrl(value: string): boolean {
	try {
		const url = new URL(value);
		const hostname = normalizedHostname(url.hostname);
		return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".localhost");
	} catch {
		return false;
	}
}

/** Normalize a node base URL and reject URLs that could hide a credential. */
export function normalizeNodeUrl(value: string): string {
	const url = new URL(value.trim());
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Use an http:// or https:// node address.");
	}
	if (url.username || url.password) {
		throw new Error("Node addresses cannot contain embedded credentials.");
	}
	if (url.search || url.hash) {
		throw new Error(
			"Remove the query string and fragment from the node address."
		);
	}
	url.pathname = url.pathname.replace(/\/+$/, "");
	return url.toString().replace(/\/$/, "");
}

export function validateNodeUrl(value: string, allowRemote: boolean): string {
	const normalized = normalizeNodeUrl(value);
	if (!(allowRemote || isLoopbackNodeUrl(normalized))) {
		throw new Error(
			"This first connection is limited to this computer. Enable remote node access only when you trust the node and its network."
		);
	}
	return normalized;
}

function authHeaders(token: string | null): HeadersInit {
	return token ? { Authorization: `Bearer ${token}` } : {};
}

async function responseError(
	response: Response,
	fallback: string
): Promise<Error> {
	let detail = "";
	try {
		detail = (await response.text()).trim().slice(0, MAX_ERROR_BODY_CHARS);
	} catch {
		// The status is still useful when the node closes the connection early.
	}
	if (response.status === 401 || response.status === 403) {
		return new Error(
			"The node rejected this token. Copy the current node token and try again."
		);
	}
	return new Error(detail || `${fallback} (${response.status}).`);
}

function describeNetworkError(error: unknown): Error {
	if (error instanceof Error && error.name === "AbortError") {
		return error;
	}
	return new Error(
		"Could not reach the node. Check that Ryu Core is running and that this browser origin is allowed by its CORS settings."
	);
}

export async function checkLocalNode(
	config: LocalNodeConfig,
	signal?: AbortSignal
): Promise<LocalNodeHealth> {
	let healthResponse: Response;
	try {
		healthResponse = await fetch(`${config.baseUrl}/api/health`, {
			cache: "no-store",
			credentials: "omit",
			headers: authHeaders(config.token),
			signal,
		});
	} catch (error) {
		throw describeNetworkError(error);
	}
	if (!healthResponse.ok) {
		throw await responseError(healthResponse, "Node health check failed");
	}

	let agentsResponse: Response;
	try {
		agentsResponse = await fetch(`${config.baseUrl}/api/agents`, {
			cache: "no-store",
			credentials: "omit",
			headers: authHeaders(config.token),
			signal,
		});
	} catch (error) {
		throw describeNetworkError(error);
	}
	if (!agentsResponse.ok) {
		throw await responseError(agentsResponse, "Node authentication failed");
	}

	const payload: unknown = await healthResponse.json().catch(() => ({}));
	if (!payload || typeof payload !== "object") {
		return { status: "ok" };
	}
	const record = payload as Record<string, unknown>;
	return {
		capabilities: record.capabilities,
		channel: typeof record.channel === "string" ? record.channel : undefined,
		status: typeof record.status === "string" ? record.status : "ok",
		version: typeof record.version === "string" ? record.version : undefined,
	};
}

function parseTextFrame(data: string): string | "done" | null {
	if (data === "[DONE]") {
		return "done";
	}
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(data) as Record<string, unknown>;
	} catch {
		return null;
	}
	if (parsed.type === "error") {
		const detail = parsed.errorText ?? parsed.error;
		throw new Error(
			typeof detail === "string" ? detail : "The local node returned an error."
		);
	}
	if (parsed.type === "text-delta" && typeof parsed.delta === "string") {
		return parsed.delta;
	}
	const choices = parsed.choices as
		| Array<{ delta?: { content?: unknown }; text?: unknown }>
		| undefined;
	const fallback = choices?.[0]?.delta?.content ?? choices?.[0]?.text;
	return typeof fallback === "string" ? fallback : null;
}

/** Stream one non-persistent, visitor-scoped turn through a running Core node. */
export async function runLocalNodeChat(
	config: LocalNodeConfig,
	messages: readonly LocalNodeChatMessage[],
	options: LocalNodeChatOptions = {}
): Promise<string> {
	let response: Response;
	try {
		response = await fetch(`${config.baseUrl}/api/chat/stream`, {
			body: JSON.stringify({
				agent_id: "default",
				browser_context_consent: false,
				browser_surface: "website-assistant",
				companion_source: false,
				messages,
				persist: false,
			}),
			cache: "no-store",
			credentials: "omit",
			headers: {
				...authHeaders(config.token),
				"Content-Type": "application/json",
				Accept: "text/event-stream",
			},
			method: "POST",
			signal: options.signal,
		});
	} catch (error) {
		throw describeNetworkError(error);
	}
	if (!(response.ok && response.body)) {
		throw await responseError(response, "Local node chat failed");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let answer = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
			let boundary = buffer.indexOf("\n\n");
			while (boundary !== -1) {
				const frame = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				const data = frame
					.split("\n")
					.filter((line) => line.startsWith("data:"))
					.map((line) => line.slice("data:".length).trim())
					.join("\n");
				if (data) {
					const parsed = parseTextFrame(data);
					if (parsed === "done") {
						return answer;
					}
					if (parsed && answer.length < MAX_ASSISTANT_CHARS) {
						const remaining = MAX_ASSISTANT_CHARS - answer.length;
						const delta = parsed.slice(0, remaining);
						answer += delta;
						options.onDelta?.(delta);
					}
				}
				boundary = buffer.indexOf("\n\n");
			}
		}
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw error;
		}
		throw error instanceof Error ? error : new Error(String(error));
	} finally {
		reader.releaseLock();
	}
	return answer;
}
