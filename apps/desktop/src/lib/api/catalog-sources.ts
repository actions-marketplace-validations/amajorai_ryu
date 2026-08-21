import { type ApiTarget, request } from "./client.ts";

/** Every catalog kind backed by Core's source registry. */
export type CatalogKind =
	| "agent"
	| "knowledge"
	| "mcp"
	| "model"
	| "plugin"
	| "skill";

export interface CatalogSource {
	baseUrl: string | null;
	builtin: boolean;
	displayName: string;
	hasAuth: boolean;
	id: string;
}

export interface CatalogSources {
	active: string;
	kind: CatalogKind;
	sources: CatalogSource[];
}

interface SourceWire {
	base_url?: string | null;
	builtin?: boolean;
	display_name: string;
	has_auth?: boolean;
	id: string;
}

function toSource(source: SourceWire): CatalogSource {
	return {
		baseUrl: source.base_url ?? null,
		builtin: source.builtin ?? false,
		displayName: source.display_name,
		hasAuth: source.has_auth ?? false,
		id: source.id,
	};
}

export async function fetchCatalogSources(
	target: ApiTarget,
	kind: CatalogKind
): Promise<CatalogSources> {
	const json = await request<{
		active?: string;
		kind?: CatalogKind;
		sources?: SourceWire[];
	}>(target, `/api/catalog/sources?kind=${kind}`);
	return {
		active: json.active ?? "",
		kind: json.kind ?? kind,
		sources: (json.sources ?? []).map(toSource),
	};
}

export interface AddCatalogSourceInput {
	authEnvVar?: string;
	baseUrl: string;
	displayName: string;
	id: string;
	kind: CatalogKind;
}

export async function addCatalogSource(
	target: ApiTarget,
	input: AddCatalogSourceInput
): Promise<void> {
	const authEnvVar = input.authEnvVar?.trim();
	const json = await request<{ error?: string; ok?: boolean }>(
		target,
		"/api/catalog/sources",
		{
			body: {
				auth: authEnvVar ? { bearer: `\${${authEnvVar}}` } : undefined,
				base_url: input.baseUrl,
				display_name: input.displayName,
				id: input.id,
				kind: input.kind,
			},
			method: "POST",
		}
	);
	if (json.ok === false) {
		throw new Error(json.error ?? "Failed to add marketplace");
	}
}

export async function removeCatalogSource(
	target: ApiTarget,
	kind: CatalogKind,
	id: string
): Promise<void> {
	const json = await request<{ error?: string; ok?: boolean }>(
		target,
		"/api/catalog/sources",
		{ body: { id, kind }, method: "DELETE" }
	);
	if (json.ok === false) {
		throw new Error(json.error ?? "Failed to remove marketplace");
	}
}

export async function reorderCatalogSource(
	target: ApiTarget,
	kind: CatalogKind,
	id: string,
	direction: "down" | "up"
): Promise<void> {
	const json = await request<{ error?: string; ok?: boolean }>(
		target,
		"/api/catalog/sources/reorder",
		{ body: { direction, id, kind }, method: "POST" }
	);
	if (json.ok === false) {
		throw new Error(json.error ?? "Failed to reorder marketplace");
	}
}

export async function selectCatalogSource(
	target: ApiTarget,
	kind: CatalogKind,
	id: string
): Promise<void> {
	await request<unknown>(target, "/api/catalog/sources/select", {
		body: { id, kind },
		method: "POST",
	});
}
