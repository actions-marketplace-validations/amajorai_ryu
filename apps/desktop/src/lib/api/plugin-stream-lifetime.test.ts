import { expect, mock, test } from "bun:test";

let response: Response;
mock.module("./client.ts", () => ({
	authenticatedFetch: () => Promise.resolve(response),
	makeHeaders: () => ({}),
	identityHeaders: () => ({}),
	request: () => Promise.resolve({}),
}));
const { pluginHostInvokeStream, pluginFinetuneStream } = await import(
	"./plugins.ts"
);
const target = { url: "http://fixture.test", token: null };
function source(text: string, closed = false) {
	let cancelled = 0;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(text));
			if (closed) {
				controller.close();
			}
		},
		cancel() {
			cancelled += 1;
		},
	});
	response = new Response(body);
	return { body, cancelled: () => cancelled };
}
const delta = (value: string) =>
	`data: ${JSON.stringify({ type: "text-delta", delta: value })}\n\n`;
const invoke = (
	kind: "host" | "finetune",
	onChunk: (value: string) => void,
	signal?: AbortSignal
) =>
	kind === "host"
		? pluginHostInvokeStream(target, "fixture", {}, { onChunk, signal })
		: pluginFinetuneStream(target, "fixture", "job", {
				onFrame: onChunk,
				signal,
			});

test("terminal host marker cancels the response and ignores trailing frames", async () => {
	const stream = source(`${delta("first")}data: [DONE]\n\n${delta("late")}`);
	const chunks: string[] = [];
	await invoke("host", (chunk) => chunks.push(chunk));
	expect(chunks).toEqual(["first"]);
	expect(stream.cancelled()).toBe(1);
	expect(stream.body.locked).toBe(false);
});
test("host error frames release the response before rejecting", async () => {
	const stream = source(
		'data: {"type":"error","errorText":"Fixture error"}\n\n'
	);
	await expect(invoke("host", () => undefined)).rejects.toThrow(
		"Fixture error"
	);
	expect(stream.cancelled()).toBe(1);
	expect(stream.body.locked).toBe(false);
});
for (const kind of ["host", "finetune"] as const) {
	test(`${kind} consumer errors cancel and unlock the reader`, async () => {
		const stream = source(delta("first"));
		await expect(
			invoke(kind, () => {
				throw new Error("Consumer stopped");
			})
		).rejects.toThrow("Consumer stopped");
		expect(stream.cancelled()).toBe(1);
		expect(stream.body.locked).toBe(false);
	});
	test(`${kind} cancellation stops buffered frames`, async () => {
		const stream = source(delta("first") + delta("late"));
		const controller = new AbortController();
		let calls = 0;
		await invoke(
			kind,
			() => {
				calls += 1;
				controller.abort();
			},
			controller.signal
		);
		expect(calls).toBe(1);
		expect(stream.cancelled()).toBe(1);
		expect(stream.body.locked).toBe(false);
	});
	test(`${kind} clean end unlocks the response`, async () => {
		const stream = source(delta("first"), true);
		let calls = 0;
		await invoke(kind, () => {
			calls += 1;
		});
		expect(calls).toBe(1);
		expect(stream.body.locked).toBe(false);
	});
}
