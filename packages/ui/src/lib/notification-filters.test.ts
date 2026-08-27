import { describe, expect, it } from "bun:test";
import {
	filterNotifications,
	notificationFilterForLevel,
	notificationFilterOptions,
	notificationLevelLabel,
} from "./notification-filters.tsx";

const items = [
	{ id: "info-unread", level: "info", read_at: null, archived_at: null },
	{ id: "warning-read", level: "warning", read_at: "2026-08-23T00:00:00Z" },
	{
		archived_at: "2026-08-23T01:00:00Z",
		id: "error-archived",
		level: "error",
		read_at: "2026-08-23T01:00:00Z",
	},
	{ id: "custom", level: "build_failure", read_at: null },
];

describe("notification filters", () => {
	it("separates status filters without losing archived rows from All", () => {
		expect(filterNotifications(items, "all").map((item) => item.id)).toEqual([
			"info-unread",
			"warning-read",
			"error-archived",
			"custom",
		]);
		expect(filterNotifications(items, "unread").map((item) => item.id)).toEqual(
			["info-unread", "custom"]
		);
		expect(
			filterNotifications(items, "archived").map((item) => item.id)
		).toEqual(["error-archived"]);
	});

	it("matches notification levels and preserves custom provider categories", () => {
		expect(
			filterNotifications(items, notificationFilterForLevel("WARNING")).map(
				(item) => item.id
			)
		).toEqual(["warning-read"]);
		expect(
			filterNotifications(
				items,
				notificationFilterForLevel("build_failure")
			).map((item) => item.id)
		).toEqual(["custom"]);
		expect(notificationLevelLabel("build_failure")).toBe("Build Failure");
	});

	it("builds stable status and level tabs with counts", () => {
		expect(notificationFilterOptions(items)).toEqual([
			{ count: 4, label: "All", value: "all" },
			{ count: 2, label: "Unread", value: "unread" },
			{ count: 1, label: "Archived", value: "archived" },
			{ count: 1, label: "Info", value: "level:info" },
			{ count: 1, label: "Warning", value: "level:warning" },
			{ count: 1, label: "Error", value: "level:error" },
			{ count: 1, label: "Build Failure", value: "level:build_failure" },
		]);
	});
});
