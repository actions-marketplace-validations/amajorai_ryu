import type {
	JournalCard as DesktopJournalCard,
	JournalSnapshot as DesktopJournalSnapshot,
	TimelineEvent,
} from "@/src/lib/api/shadow.ts";
import { invokeWhenReady } from "@/src/lib/tauri-ready.ts";

export interface SafeTimelineApp {
	icon_url: string | null;
	name: string;
}

export type SafeTimelineCard = Omit<DesktopJournalCard, "apps"> & {
	apps: SafeTimelineApp[];
};

export type SafeTimelineJournalSnapshot = Omit<
	DesktopJournalSnapshot,
	"cards"
> & {
	cards: SafeTimelineCard[];
};

interface TimelineAppIconRequest {
	app_path: string | null;
	bundle_id: string | null;
	key: string;
	name: string;
}

interface TimelineAppIconResult {
	icon_url: string | null;
	key: string;
}

type TimelineIconMap = ReadonlyMap<string, string | null>;
type TimelineIconResolver = (
	apps: TimelineAppIconRequest[]
) => Promise<TimelineIconMap>;

const iconCache = new Map<string, string | null>();

function normalized(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

/** Must stay in sync with the native resolver's stable identity inputs. */
export function timelineAppIdentityKey(app: {
	app_path?: string | null;
	bundle_id?: string | null;
	name: string;
}): string {
	const bundleId = normalized(app.bundle_id);
	if (bundleId) {
		return `bundle:${bundleId.toLowerCase()}`;
	}
	const appPath = normalized(app.app_path);
	if (appPath) {
		return `path:${appPath}`;
	}
	return `name:${normalized(app.name)?.toLowerCase() ?? "unknown"}`;
}

async function resolveTimelineAppIcons(
	apps: TimelineAppIconRequest[]
): Promise<TimelineIconMap> {
	if (apps.length === 0) {
		return new Map();
	}

	try {
		const results = await invokeWhenReady<TimelineAppIconResult[]>(
			"resolve_timeline_app_icons",
			{ apps }
		);
		return new Map(
			results.map((result) => [result.key, result.icon_url] as const)
		);
	} catch {
		// Browser/web hosts and older desktop builds do not have this optional
		// command. The Timeline still renders names/initials in that case.
		return new Map();
	}
}

function appRequestFromCardApp(app: {
	app_path: string | null;
	bundle_id: string | null;
	name: string;
}): TimelineAppIconRequest {
	return {
		app_path: normalized(app.app_path),
		bundle_id: normalized(app.bundle_id),
		key: timelineAppIdentityKey(app),
		name: app.name,
	};
}

/**
 * Add CSP-safe native icon URLs to a Shadow journal without mutating the raw
 * response or exposing its device-local app locators to the sandbox.
 */
export async function enrichTimelineJournal(
	journal: DesktopJournalSnapshot | null,
	resolveIcons: TimelineIconResolver = resolveTimelineAppIcons
): Promise<SafeTimelineJournalSnapshot | null> {
	if (!journal) {
		return null;
	}

	const requests = new Map<string, TimelineAppIconRequest>();
	for (const card of journal.cards) {
		for (const app of card.apps ?? []) {
			const request = appRequestFromCardApp(app);
			if (!iconCache.has(request.key)) {
				requests.set(request.key, request);
			}
		}
	}

	if (requests.size > 0) {
		let resolved: TimelineIconMap = new Map();
		try {
			resolved = await resolveIcons([...requests.values()]);
		} catch {
			// A native resolver failure is presentation-only; names/initials remain
			// useful and must not make the journal query fail.
		}
		for (const request of requests.values()) {
			iconCache.set(request.key, resolved.get(request.key) ?? null);
		}
	}

	const cards = journal.cards.map((card) => ({
		...card,
		apps: (card.apps ?? []).map((app) => {
			const key = timelineAppIdentityKey(app);
			return {
				icon_url: iconCache.get(key) ?? null,
				name: app.name,
			};
		}),
	}));

	return {
		...journal,
		cards,
	};
}

type SafeTimelineEvent = Omit<TimelineEvent, "app_path" | "bundle_id">;

/** Remove host-only app locators before raw replay events cross the sandbox. */
export function sanitizeTimelineEvents(
	events: TimelineEvent[] | null
): SafeTimelineEvent[] | null {
	if (!events) {
		return null;
	}
	return events.map(
		({ app_path: _appPath, bundle_id: _bundleId, ...event }) => event
	);
}

/** Test-only cache reset; production callers never need to clear native icons. */
export function resetTimelineAppIconCache(): void {
	iconCache.clear();
}
