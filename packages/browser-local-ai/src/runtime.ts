import type { TextGenerationPipeline } from "@huggingface/transformers";

import {
	type BrowserModelStatus,
	createBrowserModelDefinition,
	isValidBrowserModelId,
} from "./catalog";

export interface BrowserGenerationRequest {
	messages: Array<{
		content: string;
		role: "assistant" | "system" | "user";
	}>;
	modelId: string;
	requestId?: string;
	tools?: Record<string, unknown>[];
}

export interface BrowserGenerationResult {
	text: string;
	toolCalls: Array<{ arguments: Record<string, unknown>; name: string }>;
}

export interface BrowserRuntimeStatus {
	modelId: string;
	progress?: number;
	status: BrowserModelStatus;
	statusMessage?: string;
}

export type BrowserRuntimeListener = (status: BrowserRuntimeStatus) => void;

export interface BrowserLocalRuntimeOptions {
	onStatus?: BrowserRuntimeListener;
}

function progressValue(value: unknown): number | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const progress = (value as { progress?: unknown }).progress;
	return typeof progress === "number"
		? Math.max(0, Math.min(100, progress))
		: undefined;
}

function readGeneratedText(output: unknown): string {
	if (!Array.isArray(output) || output.length === 0) {
		return "";
	}
	const generated = output[0] as { generated_text?: unknown };
	if (typeof generated?.generated_text === "string") {
		return generated.generated_text;
	}
	if (Array.isArray(generated?.generated_text)) {
		const last = generated.generated_text.at(-1) as
			| { content?: unknown }
			| undefined;
		return typeof last?.content === "string" ? last.content : "";
	}
	return "";
}

function parseToolCalls(
	text: string
): Array<{ arguments: Record<string, unknown>; name: string }> {
	const calls: Array<{ arguments: Record<string, unknown>; name: string }> = [];
	const pattern = /\{\s*"(?:name|tool)"\s*:\s*"([^"]+)"[\s\S]*?\}/g;
	for (const match of text.matchAll(pattern)) {
		try {
			const candidate: unknown = JSON.parse(match[0]);
			if (candidate && typeof candidate === "object") {
				const object = candidate as Record<string, unknown>;
				const name = object.name ?? object.tool;
				const args = object.arguments ?? object.input ?? {};
				if (typeof name === "string" && args && typeof args === "object") {
					calls.push({
						arguments: args as Record<string, unknown>,
						name,
					});
				}
			}
		} catch {
			// Plain chat text is valid; malformed JSON is not a tool call.
		}
	}
	return calls;
}

function plainTextPrompt(
	messages: readonly BrowserGenerationRequest["messages"][number][]
): string {
	const transcript = messages
		.map(({ content, role }) => `${role.toUpperCase()}: ${content}`)
		.join("\n\n");
	return `${transcript}\n\nASSISTANT:`;
}

function hasMissingChatTemplate(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.message.toLowerCase().includes("chat_template")
	);
}

function hasWebGpu(): boolean {
	return typeof navigator !== "undefined" && "gpu" in navigator;
}

/**
 * A browser-only Transformers.js runtime. Models are loaded lazily and cached
 * by Transformers.js in the browser; no prompt or generated text leaves the tab.
 */
export class BrowserLocalRuntime {
	private readonly listeners = new Set<BrowserRuntimeListener>();
	private readonly onStatus?: BrowserRuntimeListener;
	private readonly pipelines = new Map<
		string,
		Promise<TextGenerationPipeline>
	>();
	private readonly statuses = new Map<string, BrowserRuntimeStatus>();

	constructor(options: BrowserLocalRuntimeOptions = {}) {
		this.onStatus = options.onStatus;
	}

	getStatus(modelId: string): BrowserRuntimeStatus | undefined {
		return this.statuses.get(modelId);
	}

	subscribe(listener: BrowserRuntimeListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private publish(status: BrowserRuntimeStatus): void {
		this.statuses.set(status.modelId, status);
		this.onStatus?.(status);
		for (const listener of this.listeners) {
			listener(status);
		}
	}

	private async createPipeline(
		modelId: string
	): Promise<TextGenerationPipeline> {
		if (!isValidBrowserModelId(modelId)) {
			throw new Error("Invalid Hugging Face browser model id.");
		}
		const transformers = await import("@huggingface/transformers");
		transformers.env.useBrowserCache = true;
		transformers.env.useFSCache = false;
		transformers.env.useWasmCache = true;
		const definition = createBrowserModelDefinition(modelId);
		const devices: Array<"webgpu" | "wasm"> = hasWebGpu()
			? ["webgpu", "wasm"]
			: ["wasm"];
		let lastError = "unknown browser runtime error";
		for (const device of devices) {
			this.publish({
				modelId,
				status: "preparing",
				statusMessage: `Preparing on ${device}.`,
			});
			try {
				return await transformers.pipeline("text-generation", modelId, {
					device,
					dtype: device === "webgpu" ? "q4f16" : "q4",
					progress_callback: (info: unknown) => {
						const progress = progressValue(info);
						this.publish({
							modelId,
							progress,
							status: "preparing",
							statusMessage:
								progress == null
									? `Downloading model files on ${device}…`
									: `Downloading model files (${Math.round(progress)}%).`,
						});
					},
				});
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error);
				if (device === "webgpu") {
					this.publish({
						modelId,
						status: "preparing",
						statusMessage:
							"WebGPU could not load this model; retrying with WASM…",
					});
				}
			}
		}
		this.publish({ modelId, status: "failed", statusMessage: lastError });
		throw new Error(`${definition.name} could not be prepared: ${lastError}`);
	}

	async prepare(modelId: string): Promise<void> {
		let loading = this.pipelines.get(modelId);
		if (!loading) {
			this.publish({
				modelId,
				status: "preparing",
				statusMessage: "Starting browser engine…",
			});
			loading = this.createPipeline(modelId)
				.then((generator) => {
					this.publish({
						modelId,
						status: "ready",
						statusMessage: "Ready in this browser.",
					});
					return generator;
				})
				.catch((error: unknown) => {
					this.pipelines.delete(modelId);
					throw error;
				});
			this.pipelines.set(modelId, loading);
		}
		await loading;
	}

	async generate(
		request: BrowserGenerationRequest,
		signal?: AbortSignal
	): Promise<BrowserGenerationResult> {
		await this.prepare(request.modelId);
		if (signal?.aborted) {
			throw new DOMException("Generation cancelled.", "AbortError");
		}
		const generator = await this.pipelines.get(request.modelId);
		if (!generator) {
			throw new Error("Browser model is not loaded.");
		}
		const transformers = await import("@huggingface/transformers");
		const streamer = new transformers.TextStreamer(generator.tokenizer, {
			callback_function: () => undefined,
			skip_prompt: true,
			skip_special_tokens: true,
		});
		const generationOptions = {
			do_sample: false,
			max_new_tokens: 512,
			streamer,
			tools: request.tools,
		};
		let output: unknown;
		let plainPrompt: string | undefined;
		try {
			output = await generator(request.messages, generationOptions);
		} catch (error) {
			// Some small ONNX exports (including the lightweight default) omit a
			// tokenizer chat template. Keep the structured message path first for
			// models that support it, then use a simple role transcript only for
			// this known compatibility failure.
			if (!hasMissingChatTemplate(error)) {
				throw error;
			}
			plainPrompt = plainTextPrompt(request.messages);
			output = await generator(plainPrompt, generationOptions);
		}
		let text = readGeneratedText(output);
		// Text-generation pipelines return the input string plus generated text.
		// Remove only the exact prompt we supplied; this keeps grounding context
		// from leaking into the visible answer.
		if (plainPrompt && text.startsWith(plainPrompt)) {
			text = text.slice(plainPrompt.length).trim();
		}
		return { text, toolCalls: parseToolCalls(text) };
	}
}

export function createBrowserLocalRuntime(
	options?: BrowserLocalRuntimeOptions
): BrowserLocalRuntime {
	return new BrowserLocalRuntime(options);
}

export { hasWebGpu };
