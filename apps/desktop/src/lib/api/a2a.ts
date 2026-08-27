import { type ApiTarget, request } from "./client.ts";

export type A2aTrust = "pending" | "trusted" | "revoked";
export type A2aTaskDirection = "inbound" | "outbound";
export type A2aTaskState =
	| "unknown"
	| "submitted"
	| "working"
	| "input_required"
	| "auth_required"
	| "completed"
	| "failed"
	| "canceled"
	| "rejected";
export type A2aScope =
	| "send"
	| "read"
	| "cancel"
	| "subscribe"
	| "push_config"
	| "extended_card";

export interface A2aServerConfig {
	description: string;
	displayName: string;
	enabled: boolean;
	exposeExtendedCard: boolean;
	maxConcurrentTasks: number;
	maxPayloadBytes: number;
	publicBaseUrl: string | null;
	tenantId: string;
	updatedAt: string;
}

export interface A2aPeer {
	agentCard: Record<string, unknown> | null;
	agentCardUrl: string;
	createdAt: string;
	credentialConfigured: boolean;
	credentialKind:
		| "none"
		| "bearer"
		| "api_key"
		| "basic"
		| "oauth2_client_credentials";
	enabled: boolean;
	id: string;
	lastError: string | null;
	name: string;
	tenantId: string;
	trust: A2aTrust;
	updatedAt: string;
}

export interface A2aAgentSkill {
	description: string;
	examples?: string[];
	id: string;
	inputModes?: string[];
	name: string;
	outputModes?: string[];
	tags: string[];
}

export interface A2aPublishedAgent {
	agentId: string;
	createdAt: string;
	description: string;
	enabled: boolean;
	id: string;
	name: string;
	skills: A2aAgentSkill[];
	tenantId: string;
	updatedAt: string;
}

export interface A2aPrincipal {
	createdAt: string;
	id: string;
	lastUsedAt: string | null;
	name: string;
	revokedAt: string | null;
	scopes: A2aScope[];
	tenantId: string;
}

export interface IssuedA2aToken {
	principal: A2aPrincipal;
	token: string;
}

export interface A2aTaskRecord {
	contextId: string;
	createdAt: string;
	direction: A2aTaskDirection;
	id: string;
	localAgentId: string | null;
	ownerId: string;
	peerId: string | null;
	protocolTask: Record<string, unknown>;
	revision: number;
	state: A2aTaskState;
	tenantId: string;
	updatedAt: string;
}

export type A2aPeerCredential =
	| { kind: "none" }
	| { kind: "bearer"; token: string }
	| { header: string; kind: "api_key"; value: string }
	| { kind: "basic"; password: string; username: string }
	| {
			clientId: string;
			clientSecret: string;
			kind: "oauth2_client_credentials";
			scopes: string[];
			tokenUrl: string;
	  };

export interface DiscoverA2aPeerInput {
	credential?: A2aPeerCredential;
	name?: string;
	url: string;
}

export interface PublishA2aAgentInput {
	agentId: string;
	description: string;
	enabled: boolean;
	id?: string;
	name: string;
	skills: A2aAgentSkill[];
}

export const getA2aSettings = (target: ApiTarget) =>
	request<A2aServerConfig>(target, "/api/a2a/settings");

export const saveA2aSettings = (target: ApiTarget, config: A2aServerConfig) =>
	request<A2aServerConfig>(target, "/api/a2a/settings", {
		method: "PUT",
		body: config,
	});

export const listA2aPeers = (target: ApiTarget) =>
	request<A2aPeer[]>(target, "/api/a2a/peers");

export const discoverA2aPeer = (
	target: ApiTarget,
	input: DiscoverA2aPeerInput
) =>
	request<A2aPeer>(target, "/api/a2a/discover", {
		method: "POST",
		body: input,
	});

export const setA2aPeerTrust = (
	target: ApiTarget,
	id: string,
	trust: A2aTrust
) =>
	request<A2aPeer>(target, `/api/a2a/peers/${encodeURIComponent(id)}/trust`, {
		method: "PUT",
		body: { trust },
	});

export const deleteA2aPeer = (target: ApiTarget, id: string) =>
	request<{ deleted: boolean }>(
		target,
		`/api/a2a/peers/${encodeURIComponent(id)}`,
		{ method: "DELETE" }
	);

export const listA2aPrincipals = (target: ApiTarget) =>
	request<A2aPrincipal[]>(target, "/api/a2a/principals");

export const issueA2aPrincipal = (
	target: ApiTarget,
	name: string,
	scopes: A2aScope[]
) =>
	request<IssuedA2aToken>(target, "/api/a2a/principals", {
		method: "POST",
		body: { name, scopes },
	});

export const revokeA2aPrincipal = (target: ApiTarget, id: string) =>
	request<{ revoked: boolean }>(
		target,
		`/api/a2a/principals/${encodeURIComponent(id)}`,
		{ method: "DELETE" }
	);

export const listPublishedA2aAgents = (target: ApiTarget) =>
	request<A2aPublishedAgent[]>(target, "/api/a2a/published-agents");

export const publishA2aAgent = (
	target: ApiTarget,
	input: PublishA2aAgentInput
) =>
	request<A2aPublishedAgent>(target, "/api/a2a/published-agents", {
		method: "POST",
		body: input,
	});

export const deletePublishedA2aAgent = (target: ApiTarget, id: string) =>
	request<{ deleted: boolean }>(
		target,
		`/api/a2a/published-agents/${encodeURIComponent(id)}`,
		{ method: "DELETE" }
	);

export const listA2aTasks = (target: ApiTarget) =>
	request<A2aTaskRecord[]>(target, "/api/a2a/tasks");

export const cancelA2aTask = (target: ApiTarget, id: string) =>
	request<{ cancelRequested: boolean }>(
		target,
		`/api/a2a/tasks/${encodeURIComponent(id)}/cancel`,
		{ method: "POST" }
	);
