import { describe, expect, test } from "bun:test";
import { searchBrowserDocuments } from "./data.ts";

describe("browser document retrieval", () => {
	test("ranks title matches and returns bounded citations from canonical text", () => {
		const hits = searchBrowserDocuments(
			[
				{ id: "body", title: "Other", text: "A refund can be requested." },
				{
					id: "title",
					title: "Refund policy",
					text: "Requests are accepted within 30 days.",
				},
				{ id: "unrelated", title: "Exports", text: "Download a CSV." },
			],
			"REFUND",
			1
		);
		expect(hits).toEqual([
			{
				id: "title",
				title: "Refund policy",
				excerpt: "Requests are accepted within 30 days.",
				score: 2,
			},
		]);
	});
	test("empty queries do not expose every document and ties are deterministic", () => {
		const docs = [
			{ id: "b", title: "你好", text: "世界" },
			{ id: "a", title: "你好", text: "世界" },
		];
		expect(searchBrowserDocuments(docs, " ")).toEqual([]);
		expect(searchBrowserDocuments(docs, "你好").map((hit) => hit.id)).toEqual([
			"a",
			"b",
		]);
	});
});
