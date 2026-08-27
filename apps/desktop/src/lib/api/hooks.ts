import { type ApiTarget, request } from "./client.ts";
import type { GovernanceScope, HookPolicyOverride } from "./governance.ts";

export type HookSource = "config" | "plugin";
export type HookHandlerKind = "command" | "sandbox_js" | "unknown";

export interface HookHandlerSummary {
	display: string;
	kind: HookHandlerKind;
	path?: string;
}

export interface HookInventoryItem {
	effectiveEnabled: boolean;
	enabled: boolean;
	handler: HookHandlerSummary;
	hookKey: string;
	id: string;
	localOverrides: Partial<
		Record<Extract<GovernanceScope, "node" | "user">, HookPolicyOverride>
	>;
	matcher?: Record<string, unknown>;
	ownerId: string;
	ownerName: string;
	phase: string;
	pluginEnabled: boolean;
	priority: number;
	reviewRequired: boolean;
	source: HookSource;
	trusted: boolean;
}

export interface HookInventory {
	hooks: HookInventoryItem[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (
	record: Record<string, unknown>,
	key: string
): string => {
	const value = record[key];
	if (typeof value !== "string") {
		throw new Error(`invalid hook ${key}`);
	}
	return value;
};

const requiredBoolean = (
	record: Record<string, unknown>,
	key: string
): boolean => {
	const value = record[key];
	if (typeof value !== "boolean") {
		throw new Error(`invalid hook ${key}`);
	}
	return value;
};

const parseHandler = (value: unknown): HookHandlerSummary => {
	if (!isRecord(value)) {
		throw new Error("invalid hook handler");
	}
	const kind = value.kind;
	if (kind !== "command" && kind !== "sandbox_js" && kind !== "unknown") {
		throw new Error("invalid hook handler");
	}
	return {
		display: requiredString(value, "display"),
		kind,
		...(typeof value.path === "string" ? { path: value.path } : {}),
	};
};

const parseHook = (value: unknown): HookInventoryItem => {
	if (!isRecord(value)) {
		throw new Error("invalid hook inventory item");
	}
	const source = value.source;
	if (source !== "config" && source !== "plugin") {
		throw new Error("invalid hook source");
	}
	const priority = value.priority;
	if (!(typeof priority === "number" && Number.isInteger(priority))) {
		throw new Error("invalid hook priority");
	}
	const localOverrides: HookInventoryItem["localOverrides"] = {};
	if (isRecord(value.localOverrides)) {
		for (const scope of ["node", "user"] as const) {
			const rawPolicy = value.localOverrides[scope];
			if (!isRecord(rawPolicy)) {
				continue;
			}
			localOverrides[scope] = {
				...(typeof rawPolicy.enabled === "boolean"
					? { enabled: rawPolicy.enabled }
					: {}),
				...(typeof rawPolicy.trusted === "boolean"
					? { trusted: rawPolicy.trusted }
					: {}),
			};
		}
	}
	return {
		effectiveEnabled: requiredBoolean(value, "effectiveEnabled"),
		enabled: requiredBoolean(value, "enabled"),
		handler: parseHandler(value.handler),
		hookKey: requiredString(value, "hookKey"),
		id: requiredString(value, "id"),
		localOverrides,
		ownerId: requiredString(value, "ownerId"),
		ownerName: requiredString(value, "ownerName"),
		phase: requiredString(value, "phase"),
		pluginEnabled:
			typeof value.pluginEnabled === "boolean" ? value.pluginEnabled : true,
		priority,
		reviewRequired: requiredBoolean(value, "reviewRequired"),
		source,
		trusted: requiredBoolean(value, "trusted"),
		...(isRecord(value.matcher) ? { matcher: value.matcher } : {}),
	};
};

export const parseHookInventory = (value: unknown): HookInventory => {
	if (!(isRecord(value) && Array.isArray(value.hooks))) {
		throw new Error("invalid hook inventory");
	}
	return { hooks: value.hooks.map(parseHook) };
};

export const fetchHookInventory = async (
	target: ApiTarget,
	signal?: AbortSignal
): Promise<HookInventory> => {
	const raw = await request<unknown>(target, "/api/hooks/management", {
		signal,
	});
	return parseHookInventory(raw);
};

export interface HookOverrideUpdate {
	hookKey: string;
	policy: HookPolicyOverride;
	scope: Extract<GovernanceScope, "node" | "user">;
}

export const updateHookOverride = async (
	target: ApiTarget,
	update: HookOverrideUpdate
): Promise<HookInventory> => {
	const raw = await request<unknown>(target, "/api/hooks/overrides", {
		body: update,
		method: "PUT",
	});
	return parseHookInventory(raw);
};
