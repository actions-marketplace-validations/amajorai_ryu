import { afterEach, describe, expect, it } from "bun:test";
import type { JournalSnapshot, TimelineEvent } from "@/src/lib/api/shadow.ts";
import {
	enrichTimelineJournal,
	resetTimelineAppIconCache,
	sanitizeTimelineEvents,
} from "./timeline-app-icons.ts";

function journal(): JournalSnapshot {
	return {
		apps: [],
		cards: [
			{
				apps: [
					{
						app_path: "/Applications/WhatsApp.app",
						bundle_id: "com.whatsapp.WhatsApp",
						name: "WhatsApp",
					},
				],
				category: "Communication",
				detailed_summary: "In WhatsApp: standup.",
				distraction: false,
				distractions: [],
				end_ts: 2,
				event_count: 1,
				id: "card-1",
				primary_app: "WhatsApp",
				start_ts: 1,
				summary: "Communication activity in WhatsApp.",
				title: "Standup",
			},
			{
				apps: [
					{
						app_path: "/Applications/WhatsApp.app",
						bundle_id: "com.whatsapp.WhatsApp",
						name: "WhatsApp",
					},
				],
				category: "Communication",
				detailed_summary: "In WhatsApp: follow-up.",
				distraction: false,
				distractions: [],
				end_ts: 4,
				event_count: 1,
				id: "card-2",
				primary_app: "WhatsApp",
				start_ts: 3,
				summary: "Communication activity in WhatsApp.",
				title: "Follow-up",
			},
		],
		categories: [],
		end_ts: 4,
		focus: {
			communication_minutes: 1,
			deep_work_minutes: 0,
			distraction_minutes: 0,
			focus_minutes: 1,
			focus_ratio: 1,
			longest_focus_streak_minutes: 1,
			total_minutes: 1,
		},
		standup: { blockers: [], highlights: [], tasks: [] },
		start_ts: 1,
	};
}

afterEach(() => {
	resetTimelineAppIconCache();
});

describe("timeline app icon host seam", () => {
	it("batches shared identities and strips private locators", async () => {
		let requestCount = 0;
		const safe = await enrichTimelineJournal(journal(), async (apps) => {
			requestCount += 1;
			expect(apps).toHaveLength(1);
			expect(apps[0].app_path).toBe("/Applications/WhatsApp.app");
			return new Map([[apps[0].key, "data:image/png;base64,whatsapp"]]);
		});

		expect(requestCount).toBe(1);
		expect(safe?.cards[0].apps).toEqual([
			{ icon_url: "data:image/png;base64,whatsapp", name: "WhatsApp" },
		]);
		expect("app_path" in (safe?.cards[0].apps[0] ?? {})).toBe(false);
		expect("bundle_id" in (safe?.cards[0].apps[0] ?? {})).toBe(false);
	});

	it("keeps the journal usable when native resolution fails", async () => {
		const safe = await enrichTimelineJournal(journal(), async () => {
			throw new Error("Tauri is unavailable");
		});

		expect(safe?.cards[0].apps).toEqual([{ icon_url: null, name: "WhatsApp" }]);
	});

	it("removes private identity fields from replay events", () => {
		const events: TimelineEvent[] = [
			{
				app_name: "WhatsApp",
				app_path: "/Applications/WhatsApp.app",
				bundle_id: "com.whatsapp.WhatsApp",
				event_type: "app_switch",
				track: 3,
				ts: 1,
				url: null,
				window_title: "Chat",
			},
		];

		expect(sanitizeTimelineEvents(events)).toEqual([
			{
				app_name: "WhatsApp",
				event_type: "app_switch",
				track: 3,
				ts: 1,
				url: null,
				window_title: "Chat",
			},
		]);
	});
});
