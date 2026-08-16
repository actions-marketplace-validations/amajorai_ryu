import type { ApiTarget } from "./client.ts";
import { request } from "./client.ts";
import { getPreference, setPreference } from "./preferences.ts";

export type RuleApplyMode = "auto" | "always" | "manual";

export interface AgentRule {
	enabled: boolean;
	id: string;
	mode: RuleApplyMode;
	text: string;
}

export interface AgentRulesConfig {
	applyMode: RuleApplyMode;
	autoInject: boolean;
	enabled: boolean;
	rules: AgentRule[];
	turnsPerPlan: number;
}

export interface DiscoveredProjectRule {
	applyMode?: string;
	content?: string;
	description?: string;
	enabled?: boolean;
	globs?: string[];
	id?: string;
	name?: string;
	path: string;
	provider: string;
	scope?: string;
}

interface DiscoveredProjectRuleWire {
	apply_mode?: unknown;
	content?: unknown;
	description?: unknown;
	enabled?: unknown;
	globs?: unknown;
	id?: unknown;
	mode?: unknown;
	name?: unknown;
	path?: unknown;
	provider?: unknown;
	scope?: unknown;
}

interface DiscoveryWire {
	cwd?: unknown;
	rules?: DiscoveredProjectRuleWire[];
}

export const DEFAULT_AGENT_RULES_CONFIG: AgentRulesConfig = {
	applyMode: "auto",
	autoInject: true,
	enabled: true,
	rules: [],
	turnsPerPlan: 0,
};

const RULE_MODES: RuleApplyMode[] = ["auto", "always", "manual"];

function applyMode(value: unknown, fallback: RuleApplyMode): RuleApplyMode {
	return typeof value === "string" &&
		RULE_MODES.includes(value as RuleApplyMode)
		? (value as RuleApplyMode)
		: fallback;
}

function ruleText(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value !== "object" || value === null) {
		return "";
	}
	const record = value as Record<string, unknown>;
	return typeof record.text === "string"
		? record.text
		: typeof record.content === "string"
			? record.content
			: typeof record.rule === "string"
				? record.rule
				: "";
}

/** Convert the old positional string list to the durable rule records. */
export function legacyRulesToConfig(legacyRules: string[]): AgentRulesConfig {
	return {
		...DEFAULT_AGENT_RULES_CONFIG,
		rules: legacyRules
			.map((text, index) => ({
				enabled: true,
				id: `legacy-${index}`,
				mode: "auto" as const,
				text: text.trim(),
			}))
			.filter((rule) => rule.text.length > 0),
	};
}

/** Parse and sanitize a preference without allowing corrupt data to break the editor. */
export function parseAgentRulesConfig(
	raw: string | null,
	legacyRules: string[] = []
): AgentRulesConfig {
	if (!raw?.trim()) {
		return legacyRulesToConfig(legacyRules);
	}
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const rawRules = Array.isArray(parsed.rules) ? parsed.rules : [];
		const rules = rawRules
			.map((value, index) => {
				const text = ruleText(value).trim();
				const record =
					typeof value === "object" && value !== null
						? (value as Record<string, unknown>)
						: {};
				return {
					enabled: record.enabled !== false,
					id:
						typeof record.id === "string" && record.id.length > 0
							? record.id
							: `rule-${index}`,
					mode: applyMode(record.mode, "auto"),
					text,
				};
			})
			.filter((rule) => rule.text.length > 0);
		return {
			applyMode: applyMode(parsed.applyMode, "auto"),
			autoInject: parsed.autoInject !== false,
			enabled: parsed.enabled !== false,
			rules,
			turnsPerPlan:
				typeof parsed.turnsPerPlan === "number" &&
				Number.isFinite(parsed.turnsPerPlan)
					? Math.max(0, Math.floor(parsed.turnsPerPlan))
					: 0,
		};
	} catch {
		return legacyRulesToConfig(legacyRules);
	}
}

export async function fetchDiscoveredProjectRules(
	target: ApiTarget,
	cwd?: string | null
): Promise<{ cwd: string | null; rules: DiscoveredProjectRule[] }> {
	try {
		const query = cwd?.trim() ? `?cwd=${encodeURIComponent(cwd)}` : "";
		const data = await request<DiscoveryWire>(
			target,
			`/api/rules/discover${query}`
		);
		return {
			cwd: typeof data.cwd === "string" ? data.cwd : null,
			rules: (data.rules ?? [])
				.filter((rule) => typeof rule.path === "string")
				.map((rule) => ({
					content: typeof rule.content === "string" ? rule.content : undefined,
					applyMode:
						typeof rule.apply_mode === "string"
							? rule.apply_mode
							: typeof rule.mode === "string"
								? rule.mode
								: undefined,
					description:
						typeof rule.description === "string" ? rule.description : undefined,
					enabled: typeof rule.enabled === "boolean" ? rule.enabled : undefined,
					globs: Array.isArray(rule.globs)
						? rule.globs.filter(
								(glob): glob is string => typeof glob === "string"
							)
						: undefined,
					id: typeof rule.id === "string" ? rule.id : undefined,
					name: typeof rule.name === "string" ? rule.name : undefined,
					path: rule.path as string,
					provider:
						typeof rule.provider === "string" && rule.provider.length > 0
							? rule.provider
							: "project",
					scope: typeof rule.scope === "string" ? rule.scope : undefined,
				})),
		};
	} catch {
		return { cwd: null, rules: [] };
	}
}

export async function loadAgentRulesConfig(
	target: ApiTarget,
	prefKey: string,
	legacyRules: string[]
): Promise<{ config: AgentRulesConfig; migrated: boolean }> {
	const raw = await getPreference(target, prefKey);
	return {
		config: parseAgentRulesConfig(raw, legacyRules),
		migrated:
			!raw?.trim() && legacyRules.some((rule) => rule.trim().length > 0),
	};
}

export function saveAgentRulesConfig(
	target: ApiTarget,
	prefKey: string,
	config: AgentRulesConfig
): Promise<boolean> {
	return setPreference(target, prefKey, JSON.stringify(config));
}
