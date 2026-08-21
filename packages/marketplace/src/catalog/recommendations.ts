export type RecommendationKind =
	| "app"
	| "plugin"
	| "skill"
	| "mcp"
	| "agent"
	| "model";

export interface RecommendationItem {
	description: string | null;
	iconUrl: string | null;
	id: string;
	installed: boolean;
	kind: RecommendationKind;
	name: string;
	reason: string;
}

export interface RecommendationWire {
	cadence?: string;
	enabled?: boolean;
	hidden?: boolean;
	items?: unknown;
}

export interface NormalizedRecommendations {
	cadence: "daily" | "weekly" | "monthly";
	enabled: boolean;
	hidden: boolean;
	items: RecommendationItem[];
}

const KINDS = new Set<RecommendationKind>([
	"agent",
	"app",
	"mcp",
	"model",
	"plugin",
	"skill",
]);

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cadenceValue(value: unknown): NormalizedRecommendations["cadence"] {
	return value === "daily" || value === "monthly" ? value : "weekly";
}

export function normalizeRecommendations(
	value: RecommendationWire | null | undefined
): NormalizedRecommendations {
	const items = Array.isArray(value?.items)
		? value.items.flatMap((entry): RecommendationItem[] => {
				if (!entry || typeof entry !== "object") {
					return [];
				}
				const record = entry as Record<string, unknown>;
				const id = stringValue(record.id);
				const name = stringValue(record.name);
				const kind = stringValue(record.kind);
				if (!(id && name && kind && KINDS.has(kind as RecommendationKind))) {
					return [];
				}
				return [
					{
						description: stringValue(record.description),
						iconUrl: stringValue(record.icon_url ?? record.iconUrl),
						id,
						installed: record.installed === true,
						kind: kind as RecommendationKind,
						name,
						reason:
							stringValue(record.reason) ??
							"A match for your current catalog setup.",
					},
				];
			})
		: [];

	return {
		cadence: cadenceValue(value?.cadence),
		enabled: value?.enabled !== false,
		hidden: value?.hidden === true,
		items,
	};
}
