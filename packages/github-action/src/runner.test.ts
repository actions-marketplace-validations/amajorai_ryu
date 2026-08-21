import { describe, expect, it } from "bun:test";
import type { FetchLike } from "./client.ts";
import { parseActionInputs } from "./input.ts";
import {
	buildChatRequestForTest,
	buildToolRequestForTest,
	executeAction,
} from "./runner.ts";
import type { ActionRuntime } from "./runtime.ts";

function reader(values: Record<string, string>): {
	get: (name: string) => string;
} {
	return { get: (name) => values[name] ?? "" };
}

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

describe("Ryu GitHub Action request construction", () => {
	it("builds a chat request with optional agent, execution, inference, and plugin fields", () => {
		const inputs = parseActionInputs(
			reader({
				agent: "review-agent",
				cwd: "/workspace/project",
				"enable-long-term": "true",
				inference: '{"temperature":0}',
				operation: "run",
				persist: "true",
				"plugin-flags": '{"com.ryu.audit":false}',
				prompt: "Review this",
				"worktree-isolation": "true",
			})
		);

		expect(buildChatRequestForTest(inputs, "conversation-42")).toEqual({
			agent_id: "review-agent",
			conversation_id: "conversation-42",
			cwd: "/workspace/project",
			enable_long_term: true,
			inference: { temperature: 0 },
			messages: [
				{
					content: [{ text: "Review this", type: "text" }],
					role: "user",
				},
			],
			persist: true,
			plugin_flags: { "com.ryu.audit": false },
			worktree_isolation: true,
		});
	});

	it("builds a tool request with the required agent allowlist", () => {
		const inputs = parseActionInputs(
			reader({
				agent: "release-agent",
				operation: "tool",
				"tool-arguments": '{"tag":"v1"}',
				tool: "github.create_release",
				"user-id": "ci-user",
			})
		);

		expect(buildToolRequestForTest(inputs)).toEqual({
			agent_id: "release-agent",
			arguments: { tag: "v1" },
			tool: "github.create_release",
			user_id: "ci-user",
		});
	});
});

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
