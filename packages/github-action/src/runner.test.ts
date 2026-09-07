import { describe, expect, it } from "bun:test";
import type { FetchLike } from "./client.ts";
import { executeAction } from "./runner.ts";
import type { ActionRuntime } from "./runtime.ts";

function runtime(values: Record<string, string>): ActionRuntime & {
	environment: Record<string, string>;
	outputs: Map<string, unknown>;
	secrets: string[];
} {
	const outputs = new Map<string, unknown>();
	const environment: Record<string, string> = {};
	const secrets: string[] = [];
	return {
		environment,
		getInput: (name) => values[name] ?? "",
		info: () => undefined,
		outputs,
		secrets,
		setOutput: (name, value) => outputs.set(name, value),
		setSecret: (value) => secrets.push(value),
		warning: () => undefined,
		exportVariable: (name, value) => {
			environment[name] = value;
		},
	};
}

describe("executeAction setup", () => {
	it("validates the node, masks the token, exports aliases, and writes outputs", async () => {
		const actionRuntime = runtime({ operation: "setup" });
		const requests: Array<{ path: string; authorization: string | null }> = [];
		const fetchImpl: FetchLike = async (input, init) => {
			const path = new URL(String(input)).pathname;
			const headers = new Headers(init?.headers);
			requests.push({
				authorization: headers.get("authorization"),
				path,
			});
			if (path === "/api/health") {
				return Response.json({
					status: "ok",
					version: "0.1.15",
					channel: "stable",
				});
			}
			return Response.json({ managed: false, hostname: "runner-node" });
		};

		const result = await executeAction({
			environment: {
				RYU_CORE_TOKEN: "unit-secret",
				RYU_CORE_URL: "https://node.example///",
			},
			fetchImpl,
			runtime: actionRuntime,
		});

		expect(result.node.info.managed).toBe(false);
		expect(requests).toEqual([
			{ authorization: "Bearer unit-secret", path: "/api/health" },
			{ authorization: "Bearer unit-secret", path: "/api/system/info" },
		]);
		expect(actionRuntime.secrets).toEqual(["unit-secret", "unit-secret"]);
		expect(actionRuntime.environment).toEqual({
			RYU_CORE_TOKEN: "unit-secret",
			RYU_CORE_URL: "https://node.example",
			RYU_NODE_TOKEN: "unit-secret",
			RYU_NODE_URL: "https://node.example",
		});
		expect(actionRuntime.outputs.get("node-managed")).toBe("false");
		expect(actionRuntime.outputs.get("response")).toBe("");
	});
});
