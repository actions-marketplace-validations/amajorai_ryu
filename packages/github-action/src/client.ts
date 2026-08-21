import { parseCoreChatStream, type StreamCallbacks } from "./sse.ts";
import type {
	ChatRequest,
	ChatResult,
	NodeHealth,
	NodeInfo,
	NodeSnapshot,
	ResolvedTarget,
	TargetMode,
	ToolRequest,
	ToolResult,
} from "./types.ts";

export type FetchLike = (
	input: string | URL,
	init?: RequestInit
) => Promise<Response>;

export class RyuHttpError extends Error {
	readonly path: string;
	readonly status: number;

	constructor(path: string, status: number, message: string) {
		super(`${path} failed with HTTP ${status}: ${message}`);
		this.name = "RyuHttpError";
		this.path = path;
		this.status = status;
	}
}

function timeoutSignal(timeoutMs: number): {
	signal: AbortSignal;
	clear: () => void;
} {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	return {
		signal: controller.signal,
		clear: () => clearTimeout(timer),
	};
}

function errorMessage(value: unknown): string {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const record = value as Record<string, unknown>;
		for (const key of ["error", "message", "detail"]) {
			if (typeof record[key] === "string" && record[key].length > 0) {
				return record[key] as string;
			}
		}
	}
	return "The node returned an unexpected response.";
}

function redact(message: string, token: string | null): string {
	if (!token) {
		return message;
	}
	return message.replaceAll(token, "[REDACTED]");
}

function parseJsonText(text: string): unknown {
	if (text.trim().length === 0) {
		return null;
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text.slice(0, 1000);
	}
}

function normalizeHealth(value: unknown): NodeHealth {
	const record = value && typeof value === "object" ? value : {};
	const raw = record as Record<string, unknown>;
	return {
		capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : [],
		channel: typeof raw.channel === "string" ? raw.channel : null,
		status: typeof raw.status === "string" ? raw.status : "unknown",
		version: typeof raw.version === "string" ? raw.version : null,
	};
}

function normalizeInfo(value: unknown): NodeInfo {
	const record = value && typeof value === "object" ? value : {};
	const raw = record as Record<string, unknown>;
	return {
		...raw,
		hostname: typeof raw.hostname === "string" ? raw.hostname : null,
		managed: raw.managed === true,
		orgId: typeof raw.org_id === "string" ? raw.org_id : null,
		orgName: typeof raw.org_name === "string" ? raw.org_name : null,
		os: typeof raw.os === "string" ? raw.os : null,
	};
}

export class RyuNodeClient {
	private readonly fetchImpl: FetchLike;
	private readonly target: ResolvedTarget;

	constructor(target: ResolvedTarget, fetchImpl: FetchLike = fetch) {
		this.target = target;
		this.fetchImpl = fetchImpl;
	}

	private url(path: string): string {
		return `${this.target.url}${path}`;
	}

	private headers(extra: Record<string, string> = {}): Record<string, string> {
		return {
			Accept: "application/json",
			"Content-Type": "application/json",
			...(this.target.token
				? { Authorization: `Bearer ${this.target.token}` }
				: {}),
			...extra,
		};
	}

	private async request(
		path: string,
		options: {
			body?: unknown;
			method?: string;
			timeoutMs: number;
		}
	): Promise<{ response: Response; timer: ReturnType<typeof timeoutSignal> }> {
		const timer = timeoutSignal(options.timeoutMs);
		try {
			const response = await this.fetchImpl(this.url(path), {
				body:
					options.body === undefined ? undefined : JSON.stringify(options.body),
				headers: this.headers(),
				method: options.method ?? "GET",
				signal: timer.signal,
			});
			return { response, timer };
		} catch (error) {
			timer.clear();
			if (timer.signal.aborted) {
				throw new Error(`${path} timed out after ${options.timeoutMs}ms.`);
			}
			throw new Error(
				`${path} could not reach the Ryu node: ${redact(error instanceof Error ? error.message : String(error), this.target.token)}`
			);
		}
	}

	private async openStream(
		path: string,
		options: {
			body?: unknown;
			method?: string;
			timeoutMs: number;
		}
	): Promise<{ response: Response; timer: ReturnType<typeof timeoutSignal> }> {
		const timer = timeoutSignal(options.timeoutMs);
		try {
			const response = await this.fetchImpl(this.url(path), {
				body:
					options.body === undefined ? undefined : JSON.stringify(options.body),
				headers: this.headers({ Accept: "text/event-stream" }),
				method: options.method ?? "GET",
				signal: timer.signal,
			});
			return { response, timer };
		} catch (error) {
			timer.clear();
			if (timer.signal.aborted) {
				throw new Error(`${path} timed out after ${options.timeoutMs}ms.`);
			}
			throw new Error(
				`${path} could not reach the Ryu node: ${redact(error instanceof Error ? error.message : String(error), this.target.token)}`
			);
		}
	}

	private async json<T>(
		path: string,
		options: { body?: unknown; method?: string; timeoutMs: number }
	): Promise<T> {
		const { response, timer } = await this.request(path, options);
		try {
			const text = await response.text();
			if (timer.signal.aborted) {
				throw new Error("response body timed out");
			}
			const parsed = parseJsonText(text);
			if (!response.ok) {
				throw new RyuHttpError(
					path,
					response.status,
					redact(errorMessage(parsed), this.target.token)
				);
			}
			return parsed as T;
		} catch (error) {
			if (timer.signal.aborted) {
				throw new Error(`${path} timed out after ${options.timeoutMs}ms.`);
			}
			throw error;
		} finally {
			timer.clear();
		}
	}

	async validate(mode: TargetMode, timeoutMs: number): Promise<NodeSnapshot> {
		let health: NodeHealth | null = null;
		let lastError: unknown = null;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				const rawHealth = await this.json<unknown>("/api/health", {
					timeoutMs,
				});
				health = normalizeHealth(rawHealth);
				break;
			} catch (error) {
				lastError = error;
				if (attempt === 0) {
					await new Promise<void>((resolve) => setTimeout(resolve, 250));
				}
			}
		}
		if (health === null) {
			throw lastError instanceof Error
				? lastError
				: new Error("Ryu node health check failed.");
		}

		const info = normalizeInfo(
			await this.json<unknown>("/api/system/info", { timeoutMs })
		);
		if (mode === "managed" && !info.managed) {
			throw new Error(
				"The selected target was 'managed', but the node reported managed=false. Check the managed node URL."
			);
		}
		return { health, info, mode, url: this.target.url };
	}

	async runChat(
		body: ChatRequest,
		timeoutMs: number,
		callbacks?: StreamCallbacks
	): Promise<ChatResult> {
		const opened = await this.openStream("/api/chat/stream", {
			body,
			method: "POST",
			timeoutMs,
		});
		const { response, timer } = opened;
		try {
			if (!response.ok) {
				const text = await response.text();
				throw new RyuHttpError(
					"/api/chat/stream",
					response.status,
					redact(errorMessage(parseJsonText(text)), this.target.token)
				);
			}
			if (!response.body) {
				throw new Error("/api/chat/stream returned no response body.");
			}
			const result = await parseCoreChatStream(
				response.body,
				body.conversation_id,
				callbacks
			);
			if (!result.finished) {
				throw new Error("/api/chat/stream ended before a completion frame.");
			}
			return result;
		} catch (error) {
			if (timer.signal.aborted) {
				throw new Error(`/api/chat/stream timed out after ${timeoutMs}ms.`);
			}
			if (error instanceof Error && this.target.token) {
				const safeMessage = redact(error.message, this.target.token);
				if (safeMessage !== error.message) {
					throw new Error(safeMessage);
				}
			}
			throw error;
		} finally {
			timer.clear();
		}
	}

	async callTool(body: ToolRequest, timeoutMs: number): Promise<ToolResult> {
		const { response, timer } = await this.request("/api/mcp/tools/call", {
			body,
			method: "POST",
			timeoutMs,
		});
		try {
			const text = await response.text();
			if (timer.signal.aborted) {
				throw new Error("response body timed out");
			}
			const parsed = parseJsonText(text);
			if (!response.ok) {
				throw new RyuHttpError(
					"/api/mcp/tools/call",
					response.status,
					redact(errorMessage(parsed), this.target.token)
				);
			}
			const record = parsed && typeof parsed === "object" ? parsed : {};
			const raw = record as Record<string, unknown>;
			return {
				error: typeof raw.error === "string" ? raw.error : null,
				ok: raw.ok !== false,
				output: raw.output,
			};
		} catch (error) {
			if (timer.signal.aborted) {
				throw new Error(`/api/mcp/tools/call timed out after ${timeoutMs}ms.`);
			}
			throw error;
		} finally {
			timer.clear();
		}
	}
}
