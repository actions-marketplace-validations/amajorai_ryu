import { describe, expect, test } from "bun:test";
import {
	AGENT_INTEGRATION_SNIPPET_LANGS,
	buildAgentIntegrationSnippet,
	buildGitHubActionsSnippet,
} from "./agent-integration-snippets.ts";

const BASE_URL = "http://127.0.0.1:7980";
const AGENT_ID = "review-agent";

function snippet(
	language: (typeof AGENT_INTEGRATION_SNIPPET_LANGS)[number]["id"]
): string {
	return buildAgentIntegrationSnippet({
		agentId: AGENT_ID,
		baseUrl: BASE_URL,
		hasToken: true,
		language,
	});
}

describe("agent integrations", () => {
	test("offers the supported copy-ready languages in a useful order", () => {
		expect(AGENT_INTEGRATION_SNIPPET_LANGS).toEqual([
			{ id: "typescript", label: "TypeScript SDK" },
			{ id: "python", label: "Python" },
			{ id: "go", label: "Go" },
			{ id: "curl", label: "cURL" },
		]);
	});

	test("targets the selected agent in every language", () => {
		for (const option of AGENT_INTEGRATION_SNIPPET_LANGS) {
			const output = snippet(option.id);
			expect(output).toContain(AGENT_ID);
			expect(output).toContain(BASE_URL);
			if (option.id !== "typescript") {
				expect(output).toContain(`${BASE_URL}/api/chat/stream`);
			}
		}
	});

	test("uses the typed client for the TypeScript sample", () => {
		const output = snippet("typescript");
		expect(output).toContain('import { createRyuClient } from "@ryuhq/client"');
		expect(output).toContain("client.agents.stream");
		expect(output).toContain("process.env.RYU_TOKEN");
	});

	test("only adds the cURL auth header for protected nodes", () => {
		const openOutput = buildAgentIntegrationSnippet({
			agentId: AGENT_ID,
			baseUrl: BASE_URL,
			hasToken: false,
			language: "curl",
		});
		const protectedOutput = snippet("curl");

		expect(openOutput).not.toContain("Authorization");
		expect(protectedOutput).toContain("Authorization: Bearer $RYU_TOKEN");
	});

	test("builds an agent-specific GitHub Actions workflow", () => {
		const output = buildGitHubActionsSnippet(AGENT_ID);

		expect(output).toContain("uses: amajorai/ryu@v1");
		expect(output).toContain("operation: run");
		expect(output).toContain(`agent: "${AGENT_ID}"`);
	});
});
