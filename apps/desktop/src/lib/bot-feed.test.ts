import { describe, expect, test } from "bun:test";
import type { ActivityItem } from "./api/activity.ts";
import {
	type BotFeedPreferences,
	DEFAULT_BOT_FEED_PREFERENCES,
	feedSourceForActivity,
	filterBotFeed,
} from "./bot-feed.ts";

function activity(source: string, kind = "run"): ActivityItem {
	return {
		agent_id: null,
		body: null,
		created_at: 1,
		id: `${source}-${kind}`,
		kind,
		level: "info",
		metadata: {},
		session_id: null,
		source,
		title: source,
	};
}

describe("Bot feed projection", () => {
	test("maps existing activity producers to user-facing feed groups", () => {
		expect(feedSourceForActivity(activity("runs"))).toBe("runs");
		expect(feedSourceForActivity(activity("approvals"))).toBe("approvals");
		expect(feedSourceForActivity(activity("quests"))).toBe("goals");
		expect(feedSourceForActivity(activity("monitors"))).toBe("watch");
		expect(feedSourceForActivity(activity("manual"))).toBe("notes");
		expect(feedSourceForActivity(activity("new-module", "approval"))).toBe(
			"approvals"
		);
	});

	test("filters the real activity stream without rewriting its records", () => {
		const items = [activity("runs"), activity("approvals"), activity("quests")];
		const preferences: BotFeedPreferences = { sources: ["approvals"] };
		expect(filterBotFeed(items, preferences)).toEqual([items[1]]);
		expect(filterBotFeed(items, DEFAULT_BOT_FEED_PREFERENCES)).toEqual(items);
	});
});
