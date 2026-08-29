const DEFAULT_PORT = 18_081;
const EXPECTED_DIMENSIONS = 8;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_INPUTS = 64;
const MAX_TEXT_CHARACTERS = 4096;

function configuredPort(): number {
	const raw = process.env.GRAPHRAG_EMBED_PORT;
	if (!raw) {
		return DEFAULT_PORT;
	}
	const port = Number.parseInt(raw, 10);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`Invalid GRAPHRAG_EMBED_PORT: ${raw}`);
	}
	return port;
}

function hashToken(token: string): number {
	let hash = 2_166_136_261;
	for (const character of token) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16_777_619);
	}
	return hash >>> 0;
}

function embeddingFor(text: string, dimensions: number): number[] {
	const embedding = Array.from<number>({ length: dimensions }).fill(0);
	const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
	for (const token of tokens) {
		const hash = hashToken(token);
		const index = hash % dimensions;
		const sign = (hash & 0x80_00_00_00) === 0 ? 1 : -1;
		embedding[index] += sign;
	}
	const magnitude = Math.sqrt(
		embedding.reduce((sum, component) => sum + component * component, 0)
	);
	if (magnitude === 0) {
		embedding[0] = 1;
		return embedding;
	}
	return embedding.map((component) => component / magnitude);
}

function objectValue(value: unknown, key: string): unknown {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	return (value as Record<string, unknown>)[key];
}

function jsonError(message: string, status: number): Response {
	return Response.json({ error: message }, { status });
}

async function readJsonBody(request: Request): Promise<unknown> {
	const declaredLength = Number(request.headers.get("content-length") ?? "0");
	if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
		throw new Error("request body is too large");
	}
	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
		throw new Error("request body is too large");
	}
	return JSON.parse(text) as unknown;
}

async function embeddingsResponse(request: Request): Promise<Response> {
	let body: unknown;
	try {
		body = await readJsonBody(request);
	} catch {
		return jsonError("Request body must be valid JSON under 256 KiB", 400);
	}
	const dimensionsValue = objectValue(body, "dimensions");
	const dimensions =
		typeof dimensionsValue === "number" ? dimensionsValue : Number.NaN;
	if (dimensions !== EXPECTED_DIMENSIONS) {
		return jsonError(`dimensions must equal ${EXPECTED_DIMENSIONS}`, 400);
	}
	const inputValue = objectValue(body, "input");
	const inputs =
		typeof inputValue === "string"
			? [inputValue]
			: Array.isArray(inputValue) &&
					inputValue.every((item) => typeof item === "string")
				? inputValue
				: null;
	if (
		!inputs ||
		inputs.length === 0 ||
		inputs.length > MAX_INPUTS ||
		inputs.some((input) => input.length > MAX_TEXT_CHARACTERS)
	) {
		return jsonError(
			"input must contain 1-64 strings of at most 4096 characters",
			400
		);
	}
	const modelValue = objectValue(body, "model");
	const model =
		typeof modelValue === "string" &&
		modelValue.length > 0 &&
		modelValue.length <= 128
			? modelValue
			: "graphrag-e2e";
	return Response.json({
		object: "list",
		model,
		data: inputs.map((input, index) => ({
			object: "embedding",
			index,
			embedding: embeddingFor(input, dimensions),
		})),
		usage: {
			prompt_tokens: inputs.reduce(
				(count, input) => count + (input.match(/\S+/g)?.length ?? 0),
				0
			),
			total_tokens: inputs.reduce(
				(count, input) => count + (input.match(/\S+/g)?.length ?? 0),
				0
			),
		},
	});
}

async function rerankResponse(request: Request): Promise<Response> {
	let body: unknown;
	try {
		body = await readJsonBody(request);
	} catch {
		return jsonError("Request body must be valid JSON under 256 KiB", 400);
	}
	const documentsValue = objectValue(body, "documents");
	if (
		!Array.isArray(documentsValue) ||
		documentsValue.length === 0 ||
		documentsValue.length > 50 ||
		!documentsValue.every(
			(item) => typeof item === "string" && item.length <= MAX_TEXT_CHARACTERS
		)
	) {
		return jsonError("documents must contain 1-50 bounded strings", 400);
	}
	const ranked = documentsValue
		.map((document, index) => ({
			index,
			relevance_score: document.includes("Eiffel Tower")
				? 10_000
				: documentsValue.length - index,
		}))
		.sort((left, right) => right.relevance_score - left.relevance_score);
	return Response.json({
		results: ranked,
	});
}

const server = Bun.serve({
	hostname: "127.0.0.1",
	maxRequestBodySize: MAX_BODY_BYTES,
	port: configuredPort(),
	async fetch(request) {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/health") {
			return Response.json({ ok: true });
		}
		if (request.method === "POST" && url.pathname === "/v1/embeddings") {
			return embeddingsResponse(request);
		}
		if (request.method === "POST" && url.pathname === "/rerank") {
			return rerankResponse(request);
		}
		return jsonError("Not found", 404);
	},
});

const stop = () => server.stop(true);
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
