import { expect, test } from "bun:test";
import { waitForApplicationRealtime } from "./application-realtime-lifetime.ts";

test("document close rejects pending credential wait before a connection can be created", async () => {
	const controller = new AbortController();
	let resolveJwt: (value: string) => void = () => undefined;
	let created = false;
	const jwt = new Promise<string>((resolve) => {
		resolveJwt = resolve;
	});
	const result = waitForApplicationRealtime(jwt, controller.signal).then(() => {
		created = true;
	});
	controller.abort();
	await expect(result).rejects.toThrow("document is closed");
	resolveJwt("synthetic credential");
	await Promise.resolve();
	expect(created).toBe(false);
});
test("completed joins settle normally and later document cleanup is harmless", async () => {
	const controller = new AbortController();
	await expect(
		waitForApplicationRealtime(Promise.resolve("joined"), controller.signal)
	).resolves.toBe("joined");
	controller.abort();
});
test("already-closed documents consume a late credential error", async () => {
	const controller = new AbortController();
	controller.abort();
	await expect(
		waitForApplicationRealtime(
			Promise.reject(new Error("late auth failure")),
			controller.signal
		)
	).rejects.toThrow("document is closed");
});
