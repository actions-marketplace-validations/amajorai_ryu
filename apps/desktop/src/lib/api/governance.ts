import { type ApiTarget, request } from "./client.ts";

export type GovernanceScope = "node" | "organization" | "team" | "user";

export interface GovernanceLayer<Value> {
	scope: GovernanceScope;
	value: Value | undefined;
}

export interface ResolvedGovernanceField<Value> {
	scope: GovernanceScope;
	value: Value;
}

export type GitMergeMethod = "merge" | "squash";
export type ReviewDelivery = "inline" | "detached";

export interface HookPolicyOverride {
	enabled?: boolean;
	trusted?: boolean;
}

export interface GitGovernanceSettings {
	alwaysForcePush?: boolean;
	autoMergeWhenReady?: boolean;
	branchPrefix?: string;
	commitInstructions?: string;
	createDraftPullRequests?: boolean;
	mergeMethod?: GitMergeMethod;
	pullRequestInstructions?: string;
	reviewDelivery?: ReviewDelivery;
	watchInstructions?: string;
}

export interface WorktreeGovernanceSettings {
	autoDelete?: boolean;
	autoDeleteLimit?: number;
	fetchUpstream?: boolean;
	root?: string;
}

export interface GatewayGovernanceValues {
	git?: GitGovernanceSettings;
	hooks?: Record<string, HookPolicyOverride>;
	worktrees?: WorktreeGovernanceSettings;
}

export interface GatewayGovernanceLayer {
	revision: number;
	scope: GovernanceScope;
	unavailableReason?: string;
	values: GatewayGovernanceValues;
	writable: boolean;
}

export interface GatewayGovernanceSnapshot {
	layers: GatewayGovernanceLayer[];
	schemaVersion: 1;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const parseScope = (value: unknown): GovernanceScope => {
	switch (value) {
		case "node":
		case "organization":
		case "team":
		case "user":
			return value;
		default:
			throw new Error("invalid governance scope");
	}
};

const optionalBoolean = (
	record: Record<string, unknown>,
	key: string
): boolean | undefined => {
	const value = record[key];
	return typeof value === "boolean" ? value : undefined;
};

const optionalString = (
	record: Record<string, unknown>,
	key: string
): string | undefined => {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
};

const parseHooks = (value: unknown): Record<string, HookPolicyOverride> => {
	if (!isRecord(value)) {
		return {};
	}
	const hooks: Record<string, HookPolicyOverride> = Object.create(null);
	for (const [hookKey, rawOverride] of Object.entries(value)) {
		if (!isRecord(rawOverride)) {
			continue;
		}
		const enabled = optionalBoolean(rawOverride, "enabled");
		const trusted = optionalBoolean(rawOverride, "trusted");
		hooks[hookKey] = {
			...(enabled === undefined ? {} : { enabled }),
			...(trusted === undefined ? {} : { trusted }),
		};
	}
	return hooks;
};

const parseGit = (value: unknown): GitGovernanceSettings | undefined => {
	if (!isRecord(value)) {
		return undefined;
	}
	const mergeMethod = value.mergeMethod;
	const reviewDelivery = value.reviewDelivery;
	return {
		branchPrefix: optionalString(value, "branchPrefix"),
		mergeMethod:
			mergeMethod === "merge" || mergeMethod === "squash"
				? mergeMethod
				: undefined,
		alwaysForcePush: optionalBoolean(value, "alwaysForcePush"),
		createDraftPullRequests: optionalBoolean(value, "createDraftPullRequests"),
		reviewDelivery:
			reviewDelivery === "inline" || reviewDelivery === "detached"
				? reviewDelivery
				: undefined,
		autoMergeWhenReady: optionalBoolean(value, "autoMergeWhenReady"),
		watchInstructions: optionalString(value, "watchInstructions"),
		commitInstructions: optionalString(value, "commitInstructions"),
		pullRequestInstructions: optionalString(value, "pullRequestInstructions"),
	};
};

const parseWorktrees = (
	value: unknown
): WorktreeGovernanceSettings | undefined => {
	if (!isRecord(value)) {
		return undefined;
	}
	const limit = value.autoDeleteLimit;
	return {
		root: optionalString(value, "root"),
		fetchUpstream: optionalBoolean(value, "fetchUpstream"),
		autoDelete: optionalBoolean(value, "autoDelete"),
		autoDeleteLimit:
			typeof limit === "number" && Number.isInteger(limit) ? limit : undefined,
	};
};

const parseValues = (value: unknown): GatewayGovernanceValues => {
	if (!isRecord(value)) {
		return {};
	}
	const git = parseGit(value.git);
	const worktrees = parseWorktrees(value.worktrees);
	const hooks = parseHooks(value.hooks);
	return {
		...(git ? { git } : {}),
		...(Object.keys(hooks).length > 0 ? { hooks } : {}),
		...(worktrees ? { worktrees } : {}),
	};
};

export const parseGatewayGovernanceSnapshot = (
	value: unknown
): GatewayGovernanceSnapshot => {
	if (
		!isRecord(value) ||
		value.schemaVersion !== 1 ||
		!Array.isArray(value.layers)
	) {
		throw new Error("invalid gateway governance snapshot");
	}
	const layers = value.layers.map((rawLayer): GatewayGovernanceLayer => {
		if (!isRecord(rawLayer)) {
			throw new Error("invalid governance layer");
		}
		const revision = rawLayer.revision;
		if (!(typeof revision === "number" && Number.isInteger(revision))) {
			throw new Error("invalid governance revision");
		}
		if (typeof rawLayer.writable !== "boolean") {
			throw new Error("invalid governance writable state");
		}
		return {
			revision,
			scope: parseScope(rawLayer.scope),
			values: parseValues(rawLayer.values),
			writable: rawLayer.writable,
			...(typeof rawLayer.unavailableReason === "string"
				? { unavailableReason: rawLayer.unavailableReason }
				: {}),
		};
	});
	return { layers, schemaVersion: 1 };
};

export const fetchGatewayGovernance = async (
	target: ApiTarget,
	signal?: AbortSignal
): Promise<GatewayGovernanceSnapshot> => {
	const raw = await request<unknown>(target, "/api/gateway/governance", {
		signal,
	});
	return parseGatewayGovernanceSnapshot(raw);
};

interface GovernanceKindValues {
	git: GitGovernanceSettings;
	hooks: Record<string, HookPolicyOverride>;
	worktrees: WorktreeGovernanceSettings;
}

export const updateGatewayGovernance = async <
	Kind extends keyof GovernanceKindValues,
>(
	target: ApiTarget,
	kind: Kind,
	scope: "node" | "user",
	values: GovernanceKindValues[Kind]
): Promise<GatewayGovernanceSnapshot> => {
	const raw = await request<unknown>(
		target,
		`/api/gateway/governance/${kind}`,
		{
			body: { scope, values },
			method: "PUT",
		}
	);
	return parseGatewayGovernanceSnapshot(raw);
};

const scopeRank = (scope: GovernanceScope): number => {
	switch (scope) {
		case "node":
			return 0;
		case "organization":
			return 1;
		case "team":
			return 2;
		case "user":
			return 3;
	}
};

/**
 * Resolve one field without collapsing an explicit false into absence.
 * Callers may pass layers in any order; scope rank is the single authority.
 */
export const resolveGovernanceField = <Value>(
	layers: readonly GovernanceLayer<Value>[]
): ResolvedGovernanceField<Value> | null => {
	let resolved: ResolvedGovernanceField<Value> | null = null;
	for (const layer of layers) {
		if (layer.value === undefined) {
			continue;
		}
		if (resolved && scopeRank(resolved.scope) > scopeRank(layer.scope)) {
			continue;
		}
		resolved = { scope: layer.scope, value: layer.value };
	}
	return resolved;
};
