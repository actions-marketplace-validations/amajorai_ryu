import type { ActivityItem } from "./api/activity.ts";

export const BOT_FEED_PREFERENCES_KEY = "ryu:bot-feed-preferences:v1";
export const BOT_FEED_ENGAGEMENT_KEY = "ryu:bot-feed-engagement:v1";

export const BOT_FEED_SOURCES = [
	"runs",
	"approvals",
	"goals",
	"watch",
	"notes",
] as const;

export type BotFeedSource = (typeof BOT_FEED_SOURCES)[number];

export interface BotFeedPreferences {
	sources: BotFeedSource[];
}

export interface BotFeedEngagement {
	comments: Record<string, string[]>;
	liked: string[];
}

export const DEFAULT_BOT_FEED_PREFERENCES: BotFeedPreferences = {
	sources: [...BOT_FEED_SOURCES],
};

export const DEFAULT_BOT_FEED_ENGAGEMENT: BotFeedEngagement = {
	comments: {},
	liked: [],
};

const SOURCE_SET = new Set<BotFeedSource>(BOT_FEED_SOURCES);

function storage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

function isSource(value: unknown): value is BotFeedSource {
	return typeof value === "string" && SOURCE_SET.has(value as BotFeedSource);
}

export function feedSourceForActivity(
	item: Pick<ActivityItem, "source" | "kind">
): BotFeedSource {
	switch (item.source) {
		case "approvals":
			return "approvals";
		case "monitors":
			return "watch";
		case "quests":
			return "goals";
		case "manual":
			return "notes";
		case "runs":
			return "runs";
		default:
			return item.kind === "approval" ? "approvals" : "runs";
	}
}

export function loadBotFeedPreferences(): BotFeedPreferences {
	try {
		const raw = storage()?.getItem(BOT_FEED_PREFERENCES_KEY);
		if (!raw) {
			return { sources: [...DEFAULT_BOT_FEED_PREFERENCES.sources] };
		}
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") {
			return { sources: [...DEFAULT_BOT_FEED_PREFERENCES.sources] };
		}
		const sources = Array.isArray((parsed as { sources?: unknown }).sources)
			? (parsed as { sources: unknown[] }).sources.filter(isSource)
			: [];
		return { sources: [...new Set(sources)] };
	} catch {
		return { sources: [...DEFAULT_BOT_FEED_PREFERENCES.sources] };
	}
}

export function saveBotFeedPreferences(preferences: BotFeedPreferences): void {
	try {
		storage()?.setItem(
			BOT_FEED_PREFERENCES_KEY,
			JSON.stringify({
				sources: [...new Set(preferences.sources.filter(isSource))],
			})
		);
	} catch {
		// Local presentation preferences are best-effort.
	}
}

export function loadBotFeedEngagement(): BotFeedEngagement {
	try {
		const raw = storage()?.getItem(BOT_FEED_ENGAGEMENT_KEY);
		if (!raw) {
			return { comments: {}, liked: [] };
		}
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") {
			return { comments: {}, liked: [] };
		}
		const value = parsed as {
			comments?: unknown;
			liked?: unknown;
		};
		const liked = Array.isArray(value.liked)
			? value.liked.filter(
					(entry): entry is string => typeof entry === "string"
				)
			: [];
		const comments: Record<string, string[]> = {};
		if (value.comments && typeof value.comments === "object") {
			for (const [id, entries] of Object.entries(value.comments)) {
				if (!Array.isArray(entries)) {
					continue;
				}
				const strings = entries.filter(
					(entry): entry is string =>
						typeof entry === "string" && entry.trim().length > 0
				);
				if (strings.length > 0) {
					comments[id] = strings;
				}
			}
		}
		return { comments, liked: [...new Set(liked)] };
	} catch {
		return { comments: {}, liked: [] };
	}
}

export function saveBotFeedEngagement(engagement: BotFeedEngagement): void {
	try {
		storage()?.setItem(BOT_FEED_ENGAGEMENT_KEY, JSON.stringify(engagement));
	} catch {
		// Local presentation preferences are best-effort.
	}
}

export function filterBotFeed(
	items: readonly ActivityItem[],
	preferences: BotFeedPreferences
): ActivityItem[] {
	const allowed = new Set(preferences.sources);
	return items.filter((item) => allowed.has(feedSourceForActivity(item)));
}
