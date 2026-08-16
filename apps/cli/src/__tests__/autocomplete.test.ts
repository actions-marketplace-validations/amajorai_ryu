import { expect, test } from "bun:test";
import type { AgentSummary } from "@ryuhq/core-client/agents";
import {
	agentSuggestions,
	applyAutocomplete,
	commandSuggestions,
	getAutocompleteContext,
	moveAutocompleteIndex,
} from "../core/autocomplete.ts";

const agents = [
	{ id: "research", name: "Researcher" },
	{ id: "writer", name: "Writer" },
	{ id: "ops", name: "Ops" },
] as AgentSummary[];

test("detects slash and mention contexts only at the active token", () => {
	expect(getAutocompleteContext("  /mod")).toEqual({
		kind: "slash",
		query: "mod",
		start: 2,
	});
	expect(getAutocompleteContext("summarize @res")).toEqual({
		kind: "mention",
		query: "res",
		start: 10,
	});
	expect(getAutocompleteContext("/model son")).toBeNull();
});

test("filters local commands and agents safely", () => {
	expect(commandSuggestions("mo").map((item) => item.name)).toEqual(["model"]);
	expect(agentSuggestions(agents, "WRI")).toEqual([
		{ kind: "agent", id: "writer", name: "Writer" },
	]);
});

test("moves within bounds and replaces only the completion token", () => {
	const context = getAutocompleteContext("hello @")!;
	const suggestion = agentSuggestions(agents, "")[1]!;
	expect(applyAutocomplete("hello @", context, suggestion)).toBe(
		"hello @writer "
	);
	expect(moveAutocompleteIndex(0, -1, 3)).toBe(0);
	expect(moveAutocompleteIndex(1, 1, 3)).toBe(2);
	expect(moveAutocompleteIndex(2, 1, 3)).toBe(2);
	expect(moveAutocompleteIndex(0, 1, 0)).toBe(0);
});
