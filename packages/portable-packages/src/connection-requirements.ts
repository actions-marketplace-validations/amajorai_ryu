export const CONNECTION_REQUIREMENT_FIELDS = [
	"connection_requirements",
	"connectionRequirements",
	"connections",
] as const;

export const CONNECTION_REQUIREMENT_KINDS = [
	"app",
	"plugin",
	"skill",
	"agent",
	"workflow",
	"theme",
	"output_style",
	"space",
	"profile",
	"bundle",
] as const;

export type ConnectionRequirementKind =
	(typeof CONNECTION_REQUIREMENT_KINDS)[number];

export const CONNECTION_CHECKLIST_STATES = [
	"connected",
	"needs_connection",
	"unavailable",
	"optional",
	"error",
] as const;

export type ConnectionChecklistState =
	(typeof CONNECTION_CHECKLIST_STATES)[number];

export interface ConnectionRequirement {
	/** Package kinds, agent ids, workflow ids, or other declared consumers. */
	consumers: string[];
	/** Canonical wire spelling used by package and agent descriptors. */
	display_name: string;
	/** Stable package-local identifier. It must not contain credentials. */
	id: string;
	/** Existing provider identifier, preserved as authored apart from trimming. */
	provider: string;
	purpose: string | null;
	required: boolean;
	/** Optional provider toolkit identifier, preserved as authored apart from trimming. */
	toolkit: string | null;
	/** Optional stable usage labels supplied by the descriptor author. */
	usage: string[];
}

/** Alias for callers that want to emphasize that the value is normalized. */
export type NormalizedConnectionRequirement = ConnectionRequirement;

export interface ConnectionRequirementValidationIssue {
	message: string;
	path: string;
}

export class ConnectionRequirementValidationError extends Error {
	readonly issues: ConnectionRequirementValidationIssue[];

	constructor(issues: ConnectionRequirementValidationIssue[]) {
		super(
			issues.length === 1
				? `Invalid connection requirement: ${issues[0]?.message ?? "unknown error"}`
				: `Invalid connection requirements (${issues.length} errors)`
		);
		this.name = "ConnectionRequirementValidationError";
		this.issues = issues;
	}
}

export interface ConnectionRequirementNormalizationOptions {
	/** Defaults used when a legacy declaration does not name its consumers. */
	defaultConsumers?: readonly string[];
}

export interface ConnectionHostStatus {
	message?: string;
	state: ConnectionChecklistState;
}

export type ConnectionStatusValue =
	| ConnectionHostStatus
	| ConnectionChecklistState;

export type ConnectionStatusSource =
	| ReadonlyMap<string, ConnectionStatusValue | undefined>
	| Readonly<Record<string, ConnectionStatusValue | undefined>>
	| ((requirement: ConnectionRequirement) => ConnectionStatusValue | undefined);

export interface ConnectionChecklistItem extends ConnectionRequirement {
	message?: string;
	state: ConnectionChecklistState;
}

export interface ConnectionChecklistStateCounts {
	connected: number;
	error: number;
	needs_connection: number;
	optional: number;
	unavailable: number;
}

export interface ConnectionChecklistSummary {
	byState: ConnectionChecklistStateCounts;
	items: ConnectionChecklistItem[];
	optional: number;
	required: number;
	total: number;
}

type RecordValue = Record<string, unknown>;

interface CollectedDeclaration {
	defaultConsumers: string[];
	path: string;
	value: unknown;
}

interface EntryContext {
	defaultConsumers: string[];
}

const IDENTIFIER_RE = /^\S+$/;
const SECRET_VALUE_RE =
	/(?:sk-[A-Za-z0-9_-]{16,}|rk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/;

function isRecord(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: RecordValue, key: string): boolean {
	return Object.hasOwn(value, key);
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort(compareStrings);
}

function normalizedKey(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[.-]/g, "_")
		.toLowerCase();
}

function isCredentialKey(key: string): boolean {
	const normalized = normalizedKey(key);
	return /(?:^|_)(?:api_key|access_key|access_token|authorization|bearer|client_secret|cookie|credential|credentials|passphrase|password|private_key|refresh_token|secret|token)(?:_|$)/.test(
		normalized
	);
}

function findCredentialPath(
	value: unknown,
	path: string,
	seen: Set<object>
): string | null {
	if (typeof value === "string") {
		return SECRET_VALUE_RE.test(value) ? path || "$" : null;
	}
	if (Array.isArray(value)) {
		if (seen.has(value)) {
			return null;
		}
		seen.add(value);
		for (const [index, entry] of value.entries()) {
			const found = findCredentialPath(entry, `${path}[${index}]`, seen);
			if (found) {
				return found;
			}
		}
		return null;
	}
	if (!isRecord(value)) {
		return null;
	}
	if (seen.has(value)) {
		return null;
	}
	seen.add(value);
	for (const [key, entry] of Object.entries(value)) {
		const childPath = path ? `${path}.${key}` : key;
		if (isCredentialKey(key)) {
			return childPath;
		}
		const found = findCredentialPath(entry, childPath, seen);
		if (found) {
			return found;
		}
	}
	return null;
}

function credentialIssue(
	value: unknown
): ConnectionRequirementValidationIssue | null {
	const path = findCredentialPath(value, "", new Set());
	return path
		? {
				path,
				message: "credential-shaped fields and values are not allowed",
			}
		: null;
}

function textValue(
	value: unknown,
	path: string,
	issues: ConnectionRequirementValidationIssue[],
	options: { required?: boolean; identifier?: boolean } = {}
): string | null {
	if (value === undefined || value === null) {
		if (options.required) {
			issues.push({ path, message: "must be a non-empty string" });
		}
		return null;
	}
	if (typeof value !== "string") {
		issues.push({ path, message: "must be a string" });
		return null;
	}
	const text = value.trim();
	if (!text) {
		issues.push({ path, message: "must be a non-empty string" });
		return null;
	}
	if (options.identifier && !IDENTIFIER_RE.test(text)) {
		issues.push({
			path,
			message: "must not contain whitespace or control characters",
		});
		return null;
	}
	return text;
}

function optionalText(
	value: unknown,
	path: string,
	issues: ConnectionRequirementValidationIssue[]
): string | null {
	return textValue(value, path, issues);
}

function firstValue(source: RecordValue, keys: readonly string[]): unknown {
	for (const key of keys) {
		if (hasOwn(source, key)) {
			return source[key];
		}
	}
	return undefined;
}

function normalizeStringList(
	value: unknown,
	path: string,
	issues: ConnectionRequirementValidationIssue[],
	options: { allowString?: boolean } = {}
): string[] {
	if (value === undefined) {
		return [];
	}
	if (options.allowString !== false && typeof value === "string") {
		const text = value.trim();
		if (!text) {
			issues.push({ path, message: "must contain non-empty strings" });
			return [];
		}
		return [text];
	}
	if (!Array.isArray(value)) {
		issues.push({ path, message: "must be an array of strings" });
		return [];
	}
	const result: string[] = [];
	for (const [index, entry] of value.entries()) {
		if (typeof entry !== "string" || !entry.trim()) {
			issues.push({
				path: `${path}[${index}]`,
				message: "must be a non-empty string",
			});
			continue;
		}
		result.push(entry.trim());
	}
	return uniqueSorted(result);
}

function inferConsumers(
	value: RecordValue,
	inherited: readonly string[],
	options: ConnectionRequirementNormalizationOptions,
	issues: ConnectionRequirementValidationIssue[]
): string[] {
	if (options.defaultConsumers !== undefined) {
		return uniqueSorted(
			options.defaultConsumers
				.map((consumer) => consumer.trim())
				.filter(Boolean)
		);
	}
	const declared = firstValue(value, [
		"declared_consumers",
		"declaredConsumers",
	]);
	if (declared !== undefined) {
		return normalizeStringList(declared, "consumers", issues);
	}
	const kind = firstValue(value, ["kind", "type"]);
	if (typeof kind === "string" && kind.trim()) {
		return [kind.trim()];
	}
	if (hasOwn(value, "system_prompt") || hasOwn(value, "display_name")) {
		return ["agent"];
	}
	return [...inherited];
}

function collectDeclarations(
	value: unknown,
	path: string,
	context: EntryContext,
	options: ConnectionRequirementNormalizationOptions,
	collected: CollectedDeclaration[],
	issues: ConnectionRequirementValidationIssue[],
	seen: Set<object>
): void {
	if (Array.isArray(value)) {
		for (const [index, entry] of value.entries()) {
			collected.push({
				defaultConsumers: context.defaultConsumers,
				path: `${path}[${index}]`,
				value: entry,
			});
		}
		return;
	}
	if (!isRecord(value)) {
		if (value !== undefined && value !== null) {
			issues.push({ path: path || "$", message: "must be an object or array" });
		}
		return;
	}
	if (seen.has(value)) {
		issues.push({ path: path || "$", message: "contains a cyclic value" });
		return;
	}
	seen.add(value);

	const localConsumers = inferConsumers(
		value,
		context.defaultConsumers,
		options,
		issues
	);
	let foundDeclarationField = false;
	for (const field of CONNECTION_REQUIREMENT_FIELDS) {
		if (!hasOwn(value, field)) {
			continue;
		}
		foundDeclarationField = true;
		const fieldValue = value[field];
		if (!Array.isArray(fieldValue)) {
			issues.push({
				path: path ? `${path}.${field}` : field,
				message: "must be an array of connection requirements",
			});
			continue;
		}
		for (const [index, entry] of fieldValue.entries()) {
			collected.push({
				defaultConsumers: localConsumers,
				path: `${path ? `${path}.` : ""}${field}[${index}]`,
				value: entry,
			});
		}
	}

	for (const nestedField of ["descriptor", "metadata", "manifest"] as const) {
		if (!(hasOwn(value, nestedField) && isRecord(value[nestedField]))) {
			continue;
		}
		collectDeclarations(
			value[nestedField],
			`${path ? `${path}.` : ""}${nestedField}`,
			{ defaultConsumers: localConsumers },
			options,
			collected,
			issues,
			seen
		);
	}

	if (!foundDeclarationField && hasOwn(value, "provider")) {
		collected.push({
			defaultConsumers: localConsumers,
			path: path || "$",
			value,
		});
	}
}

function derivedRequirementId(
	provider: string,
	toolkit: string | null
): string {
	return toolkit ? `${provider}:${toolkit}` : provider;
}

function normalizeEntry(
	value: unknown,
	path: string,
	defaultConsumers: readonly string[],
	issues: ConnectionRequirementValidationIssue[]
): ConnectionRequirement | null {
	const source: RecordValue =
		typeof value === "string"
			? { provider: value }
			: isRecord(value)
				? value
				: {};
	if (typeof value !== "string" && !isRecord(value)) {
		issues.push({ path, message: "must be a string or object" });
		return null;
	}

	const provider = textValue(source.provider, `${path}.provider`, issues, {
		identifier: true,
		required: true,
	});
	if (!provider) {
		return null;
	}
	const toolkit = textValue(source.toolkit, `${path}.toolkit`, issues, {
		identifier: true,
	});
	const rawId = source.id;
	const id =
		rawId === undefined
			? derivedRequirementId(provider, toolkit)
			: textValue(rawId, `${path}.id`, issues, { identifier: true });
	if (!id) {
		return null;
	}

	const displayName = textValue(
		firstValue(source, ["display_name", "displayName", "name", "label"]),
		`${path}.display_name`,
		issues
	);
	const purpose = optionalText(source.purpose, `${path}.purpose`, issues);

	const requiredValue = source.required;
	const optionalValue = source.optional;
	if (requiredValue !== undefined && typeof requiredValue !== "boolean") {
		issues.push({ path: `${path}.required`, message: "must be a boolean" });
	}
	if (optionalValue !== undefined && typeof optionalValue !== "boolean") {
		issues.push({ path: `${path}.optional`, message: "must be a boolean" });
	}
	if (
		typeof requiredValue === "boolean" &&
		typeof optionalValue === "boolean" &&
		requiredValue === optionalValue
	) {
		issues.push({
			path,
			message: "required and optional declarations disagree",
		});
	}
	const required =
		typeof requiredValue === "boolean"
			? requiredValue
			: typeof optionalValue === "boolean"
				? !optionalValue
				: true;

	const consumerValue = firstValue(source, [
		"consumers",
		"declared_consumers",
		"declaredConsumers",
	]);
	const consumerIssues: ConnectionRequirementValidationIssue[] = [];
	const consumers =
		consumerValue === undefined
			? uniqueSorted(defaultConsumers)
			: normalizeStringList(consumerValue, `${path}.consumers`, consumerIssues);
	issues.push(...consumerIssues);
	const usageValue = firstValue(source, [
		"usage",
		"uses",
		"declared_usage",
		"declaredUsage",
	]);
	const usage = normalizeStringList(usageValue, `${path}.usage`, issues);

	return {
		consumers,
		display_name:
			displayName ??
			(toolkit ? `${provider} (${toolkit})` : provider)
				.split(/[._:-]+/)
				.filter(Boolean)
				.map(
					(part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
				)
				.join(" "),
		id,
		provider,
		purpose,
		required,
		toolkit,
		usage,
	};
}

function mergeRequirements(
	left: ConnectionRequirement,
	right: ConnectionRequirement,
	path: string,
	issues: ConnectionRequirementValidationIssue[]
): ConnectionRequirement {
	if (left.provider !== right.provider || left.toolkit !== right.toolkit) {
		issues.push({
			path,
			message: `id ${JSON.stringify(left.id)} maps to multiple providers or toolkits`,
		});
	}
	const displayNames = uniqueSorted([left.display_name, right.display_name]);
	const purposes = uniqueSorted(
		[left.purpose, right.purpose].filter((purpose): purpose is string =>
			Boolean(purpose)
		)
	);
	return {
		...left,
		display_name: displayNames[0] ?? left.display_name,
		purpose: purposes[0] ?? null,
		required: left.required || right.required,
		consumers: uniqueSorted([...left.consumers, ...right.consumers]),
		usage: uniqueSorted([...left.usage, ...right.usage]),
	};
}

function normalizeDefaults(
	options: ConnectionRequirementNormalizationOptions
): string[] {
	return options.defaultConsumers
		? uniqueSorted(
				options.defaultConsumers
					.map((consumer) => consumer.trim())
					.filter(Boolean)
			)
		: [];
}

export function normalizeConnectionRequirement(
	value: unknown,
	options: ConnectionRequirementNormalizationOptions = {}
): ConnectionRequirement {
	const secret = credentialIssue(value);
	if (secret) {
		throw new ConnectionRequirementValidationError([secret]);
	}
	const issues: ConnectionRequirementValidationIssue[] = [];
	const normalized = normalizeEntry(
		value,
		"$",
		normalizeDefaults(options),
		issues
	);
	if (issues.length > 0 || !normalized) {
		throw new ConnectionRequirementValidationError(issues);
	}
	return normalized;
}

export function normalizeConnectionRequirements(
	value: unknown,
	options: ConnectionRequirementNormalizationOptions = {}
): ConnectionRequirement[] {
	const secret = credentialIssue(value);
	if (secret) {
		throw new ConnectionRequirementValidationError([secret]);
	}
	const issues: ConnectionRequirementValidationIssue[] = [];
	const collected: CollectedDeclaration[] = [];
	const inferredDefaults = normalizeDefaults(options);
	collectDeclarations(
		value,
		"$",
		{ defaultConsumers: inferredDefaults },
		options,
		collected,
		issues,
		new Set()
	);
	const normalized: ConnectionRequirement[] = [];
	for (const declaration of collected) {
		const entry = normalizeEntry(
			declaration.value,
			declaration.path,
			declaration.defaultConsumers,
			issues
		);
		if (entry) {
			normalized.push(entry);
		}
	}
	const byId = new Map<string, ConnectionRequirement>();
	for (const requirement of normalized) {
		const existing = byId.get(requirement.id);
		byId.set(
			requirement.id,
			existing
				? mergeRequirements(
						existing,
						requirement,
						`id:${requirement.id}`,
						issues
					)
				: requirement
		);
	}
	if (issues.length > 0) {
		throw new ConnectionRequirementValidationError(issues);
	}
	return [...byId.values()].sort((left, right) =>
		compareStrings(left.id, right.id)
	);
}

export function validateConnectionRequirements(
	value: unknown,
	options: ConnectionRequirementNormalizationOptions = {}
): ConnectionRequirement[] {
	return normalizeConnectionRequirements(value, options);
}

export function normalizeAgentConnectionRequirements(
	value: unknown
): ConnectionRequirement[] {
	return normalizeConnectionRequirements(value, {
		defaultConsumers: ["agent"],
	});
}

export function normalizePackageConnectionRequirements(
	value: unknown,
	options: ConnectionRequirementNormalizationOptions = {}
): ConnectionRequirement[] {
	return normalizeConnectionRequirements(value, options);
}

function hostStatusFor(
	source: ConnectionStatusSource | undefined,
	requirement: ConnectionRequirement
): ConnectionStatusValue | undefined {
	if (!source) {
		return undefined;
	}
	if (typeof source === "function") {
		return source(requirement);
	}
	if (
		typeof source === "object" &&
		source !== null &&
		"get" in source &&
		typeof source.get === "function"
	) {
		return source.get(requirement.id);
	}
	return (
		source as Readonly<Record<string, ConnectionStatusValue | undefined>>
	)[requirement.id];
}

function normalizedHostStatus(
	value: ConnectionStatusValue | undefined
): ConnectionHostStatus | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value === "string") {
		return CONNECTION_CHECKLIST_STATES.includes(value)
			? { state: value }
			: {
					message: "host supplied an invalid connection status",
					state: "error",
				};
	}
	if (!isRecord(value)) {
		return {
			message: "host supplied an invalid connection status",
			state: "error",
		};
	}
	const state = value.state;
	if (
		typeof state !== "string" ||
		!CONNECTION_CHECKLIST_STATES.includes(state as ConnectionChecklistState)
	) {
		return {
			message: "host supplied an invalid connection status",
			state: "error",
		};
	}
	const message =
		typeof value.message === "string" && value.message.trim()
			? value.message.trim()
			: undefined;
	return { message, state: state as ConnectionChecklistState };
}

function checklistState(
	requirement: ConnectionRequirement,
	hostStatus: ConnectionHostStatus | undefined
): ConnectionChecklistItem {
	const suppliedState = hostStatus?.state;
	const state =
		suppliedState === undefined
			? requirement.required
				? "needs_connection"
				: "optional"
			: suppliedState === "optional" && requirement.required
				? "needs_connection"
				: suppliedState;
	return {
		...requirement,
		...(hostStatus?.message ? { message: hostStatus.message } : {}),
		state,
	};
}

export function deriveConnectionChecklist(
	value: unknown,
	statuses?: ConnectionStatusSource
): ConnectionChecklistSummary {
	const requirements = normalizeConnectionRequirements(value);
	const items = requirements.map((requirement) =>
		checklistState(
			requirement,
			normalizedHostStatus(hostStatusFor(statuses, requirement))
		)
	);
	const byState: ConnectionChecklistStateCounts = {
		connected: 0,
		error: 0,
		needs_connection: 0,
		optional: 0,
		unavailable: 0,
	};
	for (const item of items) {
		byState[item.state] += 1;
	}
	return {
		byState,
		items,
		optional: requirements.filter((requirement) => !requirement.required)
			.length,
		required: requirements.filter((requirement) => requirement.required).length,
		total: requirements.length,
	};
}

/** Alias with a noun-first name for callers building an install checklist. */
export const connectionChecklistSummary = deriveConnectionChecklist;
