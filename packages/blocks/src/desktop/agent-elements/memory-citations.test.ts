import { describe, expect, test } from "bun:test";
import {
	extractMemoryCitations,
	MEMORY_CITATIONS_PART,
} from "./memory-citations.ts";

describe("extractMemoryCitations", () => {
	test("reads and deduplicates citations from message parts", () => {
		expect(
			extractMemoryCitations([
				{
					type: MEMORY_CITATIONS_PART,
					data: {
						citations: [
							{ id: "memory-1", content: " Uses dark mode. " },
							{ id: "memory-1", content: "duplicate" },
							{ id: "memory-2", content: "Prefers concise answers." },
						],
					},
				},
			])
		).toEqual([
			{ id: "memory-1", content: "Uses dark mode." },
			{ id: "memory-2", content: "Prefers concise answers." },
		]);
	});

	test("ignores malformed parts and empty entries", () => {
		expect(
			extractMemoryCitations([
				null,
				{ type: "text", text: "hello" },
				{ type: MEMORY_CITATIONS_PART, data: null },
				{
					type: MEMORY_CITATIONS_PART,
					data: {
						citations: [
							{ id: "", content: "ignored" },
							{ id: "memory-3", content: "   " },
						],
					},
				},
			])
		).toEqual([]);
	});
});
