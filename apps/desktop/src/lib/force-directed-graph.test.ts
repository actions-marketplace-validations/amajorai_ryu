import { describe, expect, test } from "bun:test";
import { layoutForceGraph } from "./force-directed-graph.ts";

describe("layoutForceGraph", () => {
	test("returns one deterministic point for every node", () => {
		const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
		const edges = [
			{ source: "a", target: "b" },
			{ source: "b", target: "c" },
		];

		const first = layoutForceGraph(nodes, edges);
		const second = layoutForceGraph(nodes, edges);

		expect([...first.keys()]).toEqual(["a", "b", "c"]);
		expect(first).toEqual(second);
		for (const point of first.values()) {
			expect(Number.isFinite(point.x)).toBe(true);
			expect(Number.isFinite(point.y)).toBe(true);
		}
		expect(
			new Set([...first.values()].map(({ x, y }) => `${x},${y}`)).size
		).toBe(nodes.length);
		expect(first).not.toEqual(layoutForceGraph(nodes, []));
	});

	test("ignores edges that point to nodes outside the graph", () => {
		const points = layoutForceGraph(
			[{ id: "a" }],
			[{ source: "a", target: "missing" }]
		);

		expect(points).toEqual(layoutForceGraph([{ id: "a" }], []));
	});
});
