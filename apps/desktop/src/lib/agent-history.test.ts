import { expect, test } from "bun:test";
import { agentSupportsHistoryHint } from "./agent-history.ts";

const agent = (overrides: {
	builtIn?: boolean;
	engine?: string | null;
	id?: string;
}) => ({
	builtIn: false,
	engine: null,
	id: "custom",
	...overrides,
});

test("history engine hint accepts Claude and Codex agents", () => {
	expect(agentSupportsHistoryHint(agent({ engine: "claude" }))).toBe(true);
	expect(agentSupportsHistoryHint(agent({ engine: "acp:codex" }))).toBe(true);
});

test("history engine hint rejects unsupported or custom agents", () => {
	expect(agentSupportsHistoryHint(agent({ engine: "cursor" }))).toBe(false);
	expect(agentSupportsHistoryHint(agent({ id: "codex", builtIn: false }))).toBe(
		false
	);
});
