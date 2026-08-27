import { describe, expect, it } from "bun:test";
import {
	buildVersionDiff,
	groupVersionsByDate,
	type VersionMeta,
} from "./VersionHistory.tsx";

describe("buildVersionDiff", () => {
	it("keeps stable lines aligned across insertions and removals", () => {
		expect(buildVersionDiff("Alpha\nBeta\nGamma", "Alpha\nNew\nGamma")).toEqual(
			[
				{ id: "unchanged-0", kind: "unchanged", text: "Alpha" },
				{ id: "added-1", kind: "added", text: "New" },
				{ id: "removed-2", kind: "removed", text: "Beta" },
				{ id: "unchanged-3", kind: "unchanged", text: "Gamma" },
			]
		);
	});

	it("uses a bounded fallback for very large pages", () => {
		const before = Array.from(
			{ length: 501 },
			(_, index) => `before-${index}`
		).join("\n");
		const after = Array.from(
			{ length: 501 },
			(_, index) => `after-${index}`
		).join("\n");
		const rows = buildVersionDiff(before, after);

		expect(rows).toHaveLength(1002);
		expect(rows[0]).toMatchObject({ kind: "removed", text: "before-0" });
		expect(rows[1]).toMatchObject({ kind: "added", text: "after-0" });
	});
});

describe("groupVersionsByDate", () => {
	it("groups by the checkpoint's latest captured edit time", () => {
		const day = 24 * 60 * 60 * 1000;
		const versions: VersionMeta[] = [
			{ id: "latest", createdAt: 10 * day, updatedAt: 12 * day },
			{ id: "same-day", createdAt: 12 * day + 1000 },
			{ id: "older", createdAt: 9 * day },
		];

		const groups = groupVersionsByDate(versions);
		expect(groups).toHaveLength(2);
		expect(groups[0]?.versions.map((version) => version.id)).toEqual([
			"latest",
			"same-day",
		]);
		expect(groups[1]?.versions.map((version) => version.id)).toEqual(["older"]);
	});
});
