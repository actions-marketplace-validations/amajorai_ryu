import { describe, expect, test } from "bun:test";
import { selectHumanNotificationTargets } from "./human-notification.ts";

describe("selectHumanNotificationTargets", () => {
	test("deduplicates selected users and excludes the sender", () => {
		expect(
			selectHumanNotificationTargets({
				content: "@Ada Lovelace please review @Current User",
				currentUserId: "me",
				selected: [
					{ id: "ada", label: "Ada Lovelace" },
					{ id: "ada", label: "Ada Lovelace" },
					{ id: "me", label: "Current User" },
				],
			})
		).toEqual([{ id: "ada", label: "Ada Lovelace" }]);
	});

	test("drops selected users whose visible token was removed", () => {
		expect(
			selectHumanNotificationTargets({
				content: "Please review this",
				currentUserId: null,
				selected: [{ id: "ada", label: "Ada Lovelace" }],
			})
		).toEqual([]);
	});

	test("fails closed for an empty draft or a stale label", () => {
		const selected = [{ id: "ada", label: "Ada Lovelace" }];
		expect(
			selectHumanNotificationTargets({
				content: "",
				currentUserId: null,
				selected,
			})
		).toEqual([]);
		expect(
			selectHumanNotificationTargets({
				content: "@Ada",
				currentUserId: null,
				selected,
			})
		).toEqual([]);
	});
});
