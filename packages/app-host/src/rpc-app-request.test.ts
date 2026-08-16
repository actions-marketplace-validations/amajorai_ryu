import { describe, expect, test } from "bun:test";
import {
	asAppRequestArg,
	capabilitiesFromGrants,
	dispatchRpc,
	type HostServices,
} from "./rpc.ts";

const services = (appRequest: HostServices["appRequest"]): HostServices => ({
	appRequest,
	listAgents: () => Promise.resolve([]),
	registerRoute: () => Promise.resolve(null),
});

describe("asAppRequestArg", () => {
	test("normalizes a relative path and preserves a valid request", () => {
		expect(
			asAppRequestArg({
				body: { message: "hello" },
				method: "POST",
				path: "/pulls/openai/codex/42/comment?notify=true",
			})
		).toEqual({
			body: { message: "hello" },
			method: "POST",
			path: "/pulls/openai/codex/42/comment?notify=true",
		});
	});

	test("rejects host selection, traversal, backslashes, and unknown methods", () => {
		expect(asAppRequestArg({ path: "https://evil.test/x" })).toBeNull();
		expect(asAppRequestArg({ path: "//evil.test/x" })).toBeNull();
		expect(asAppRequestArg({ path: "/%2e%2e/settings" })).toBeNull();
		expect(asAppRequestArg({ path: "/..\\settings" })).toBeNull();
		expect(asAppRequestArg({ method: "CONNECT", path: "/status" })).toBeNull();
	});

	test("dispatches only with the Gateway-approved app:http grant", async () => {
		const appRequest = async (input: unknown) => ({ input });
		const args = [{ method: "GET", path: "/status" }];
		await expect(
			dispatchRpc(
				"app.request",
				args,
				capabilitiesFromGrants(["app:http"]),
				services(appRequest)
			)
		).resolves.toEqual({ input: args[0] });
		await expect(
			dispatchRpc("app.request", args, new Set(), services(appRequest))
		).rejects.toMatchObject({ code: "denied" });
	});
});
