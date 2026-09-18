import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";

if (typeof document === "undefined") {
	GlobalRegistrator.register();
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
mock.module("@ryu/env/web", () => ({
	env: { NEXT_PUBLIC_SERVER_URL: "http://fixture.test" },
}));
const { GiftSettlement } = await import(
	"../../../web/src/app/success/gift-settlement.tsx"
);
const originalFetch = globalThis.fetch;
const originalClear = globalThis.clearTimeout;
const calls: { signal: AbortSignal; resolve: (response: Response) => void }[] =
	[];
const container = document.createElement("div");
let root = createRoot(container);
let timers = spyOn(globalThis, "setTimeout");
let clears = spyOn(globalThis, "clearTimeout");
async function render(checkoutId?: string) {
	globalThis.fetch = Object.assign(
		(_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
			new Promise<Response>((resolve) => {
				calls.push({ signal: init?.signal as AbortSignal, resolve });
			}),
		{ preconnect: originalFetch.preconnect }
	);
	await act(async () =>
		root.render(<GiftSettlement checkoutId={checkoutId} />)
	);
}
async function answer(index: number, status: string, httpStatus = 200) {
	await act(async () =>
		calls[index].resolve(Response.json({ status }, { status: httpStatus }))
	);
}
afterEach(async () => {
	await act(async () => root.unmount());
	for (let i = 0; i < timers.mock.calls.length; i++) {
		if (timers.mock.calls[i][1] === 1500) {
			originalClear(
				timers.mock.results[i].value as ReturnType<typeof setTimeout>
			);
		}
	}
	timers.mockRestore();
	clears.mockRestore();
	timers = spyOn(globalThis, "setTimeout");
	clears = spyOn(globalThis, "clearTimeout");
	root = createRoot(container);
	calls.length = 0;
	globalThis.fetch = originalFetch;
});
test("checkout replacement resets status and aborts the old read", async () => {
	await render("first");
	await answer(0, "active");
	expect(container.textContent).toContain("Gift ready");
	await render("second");
	expect(container.textContent).toContain("Verifying");
	expect(calls[0].signal.aborted).toBe(true);
	await answer(1, "active");
	expect(container.textContent).toContain("Gift ready");
});
test("a delayed old response body cannot complete a replacement checkout", async () => {
	await render("first");
	let finish!: (value: { status: string }) => void;
	const body = new Promise<{ status: string }>((resolve) => {
		finish = resolve;
	});
	const response = new Response(null);
	response.json = () => body;
	await act(async () => calls[0].resolve(response));
	await render("second");
	await act(async () => finish({ status: "active" }));
	expect(container.textContent).toContain("Verifying");
	await answer(1, "active");
	expect(container.textContent).toContain("Gift ready");
});
test("unmount clears the scheduled retry instead of leaving a sleeping task", async () => {
	await render("first");
	await answer(0, "pending", 202);
	const index = timers.mock.calls.findIndex((call) => call[1] === 1500);
	expect(index).toBeGreaterThanOrEqual(0);
	const handle = timers.mock.results[index].value;
	await act(async () => root.unmount());
	root = createRoot(container);
	expect(clears).toHaveBeenCalledWith(handle);
	expect(calls[0].signal.aborted).toBe(true);
	expect(calls).toHaveLength(1);
});
test("missing checkout never starts a reconciliation read", async () => {
	await render();
	expect(calls).toHaveLength(0);
});
