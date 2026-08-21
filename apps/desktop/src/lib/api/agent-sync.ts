// Typed client for the Gateway's agent-root import/export sync surface.

import { type ApiTarget, request } from "./client.ts";
import type {
	ImportItemKind,
	ImportOutcome,
	ImportSelection,
} from "./import.ts";

export type SyncProvider = "claude" | "codex" | "cursor" | "other";

export interface AgentSyncProfile {
	conflictCount: number;
	exportEnabled: boolean;
	id: string;
	importEnabled: boolean;
	lastOperationId: string | null;
	provider: SyncProvider;
	root: string;
	status: string;
	updatedAt: number;
}

export interface AgentSyncProfileInput {
	exportEnabled: boolean;
	id?: string;
	importEnabled: boolean;
	provider: SyncProvider;
	root: string;
}

export interface NativeThread {
	cwd?: string;
	engine: string;
	git_branch?: string;
	id: string;
	message_count: number;
	native_session_id?: string;
	title: string;
	updated_at: number;
}

export interface AgentSyncCapabilities {
	acpLoadResume: boolean | null;
	nativeConversationExport: boolean;
	nativeThreads: boolean;
	note: string | null;
	portableBundle: boolean;
	setupImport: boolean;
}

export interface AgentSyncScanItem {
	already_exists?: boolean;
	detail?: string;
	id: string;
	kind: ImportItemKind;
	title: string;
}

export interface AgentSyncScan {
	agentId: string | null;
	capabilities: AgentSyncCapabilities;
	items: AgentSyncScanItem[];
	provider: SyncProvider;
	root: string;
	threads: NativeThread[];
	warnings: string[];
}

export interface AgentSyncImportResult {
	conflicts: number;
	dryRun: boolean;
	failed: number;
	imported: number;
	operationId: string;
	profileId: string;
	results: ImportOutcome[];
	skipped: number;
}

export interface AcpResumeStatus {
	agentId: string | null;
	conversationId: string;
	mode: "load" | "resume" | "replay" | string;
	reason: string;
}

export interface AgentSyncExportResult {
	acpResume: AcpResumeStatus[];
	agents: number;
	bundleHash: string;
	bundlePath: string;
	conflicts: number;
	conversations: number;
	destination: string;
	dryRun: boolean;
	messages: number;
	operationId: string;
	profileId: string | null;
	projectedFiles: number;
	skills: number;
	warnings: string[];
}

export interface AgentSyncResumeResult {
	agentId: string | null;
	conversationId: string;
	mode: "load" | "replay" | string;
	nativeSessionId: string | null;
	reason: string;
	response: unknown;
}

export interface AgentSyncBinding {
	agentId: string;
	capabilities: unknown;
	conversationId: string;
	engine: string;
	nativeSessionId: string;
	nodeId: string;
	updatedAt: number;
	workingDirectory: string | null;
}

export interface AgentSyncStatus {
	activeOperations: number;
	bindings: AgentSyncBinding[];
	items: AgentSyncItemStatus[];
	nodeId: string;
	profiles: AgentSyncProfile[];
}

export interface AgentSyncItemStatus {
	conflict: unknown;
	generatedHash: string | null;
	kind: string;
	operationId: string | null;
	profileId: string;
	revision: number;
	sourceHash: string | null;
	sourceId: string;
	state: string;
	updatedAt: number;
}

function toImportOutcome(result: ImportOutcomeWire): ImportOutcome {
	return {
		alreadyExists: result.already_exists ?? false,
		detail: result.detail,
		folderPath: result.folder_path,
		id: result.id,
		kind: result.kind,
		status: result.status,
		title: result.title,
	};
}

interface ImportOutcomeWire {
	already_exists?: boolean;
	detail?: string;
	folder_path?: string;
	id: string;
	kind: ImportItemKind;
	status: "imported" | "skipped" | "failed";
	title: string;
}

function toImportResult(body: {
	conflicts?: number;
	dryRun?: boolean;
	failed?: number;
	imported?: number;
	operationId?: string;
	profileId?: string;
	results?: ImportOutcomeWire[];
	skipped?: number;
}): AgentSyncImportResult {
	return {
		conflicts: body.conflicts ?? 0,
		dryRun: body.dryRun ?? false,
		failed: body.failed ?? 0,
		imported: body.imported ?? 0,
		operationId: body.operationId ?? "unknown",
		profileId: body.profileId ?? "unknown",
		results: (body.results ?? []).map(toImportOutcome),
		skipped: body.skipped ?? 0,
	};
}

export function listAgentSyncProfiles(
	target: ApiTarget
): Promise<{ profiles: AgentSyncProfile[] }> {
	return request<{ profiles?: AgentSyncProfile[] }>(
		target,
		"/api/agent-sync/profiles"
	).then((body) => ({ profiles: body.profiles ?? [] }));
}

export function saveAgentSyncProfile(
	target: ApiTarget,
	input: AgentSyncProfileInput
): Promise<AgentSyncProfile> {
	return request<AgentSyncProfile>(target, "/api/agent-sync/profiles", {
		method: "POST",
		body: input,
	});
}

export async function deleteAgentSyncProfile(
	target: ApiTarget,
	id: string
): Promise<void> {
	await request(target, `/api/agent-sync/profiles/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
}

export function scanAgentSyncRoot(
	target: ApiTarget,
	path: string,
	provider?: SyncProvider
): Promise<AgentSyncScan> {
	return request<AgentSyncScan>(target, "/api/agent-sync/scan", {
		method: "POST",
		body: { path, provider },
	});
}

export async function importAgentSyncThread(
	target: ApiTarget,
	input: { agentId: string; threadId: string }
): Promise<{
	alreadyImported: boolean;
	conversationId: string | null;
	messagesAdded: number;
}> {
	const body = await request<{
		already_imported?: boolean;
		conversation_id?: string;
		messages_added?: number;
	}>(target, "/api/agent-sync/threads/import", {
		method: "POST",
		body: {
			agentId: input.agentId,
			threadId: input.threadId,
		},
	});
	return {
		alreadyImported: body.already_imported ?? false,
		conversationId: body.conversation_id ?? null,
		messagesAdded: body.messages_added ?? 0,
	};
}

export async function importAgentSyncItems(
	target: ApiTarget,
	input: {
		dryRun?: boolean;
		items: ImportSelection[];
		path?: string;
		profileId: string;
	}
): Promise<AgentSyncImportResult> {
	const body = await request<{
		conflicts?: number;
		dryRun?: boolean;
		failed?: number;
		imported?: number;
		operationId?: string;
		profileId?: string;
		results?: ImportOutcomeWire[];
		skipped?: number;
	}>(target, "/api/agent-sync/import", {
		method: "POST",
		body: {
			dryRun: input.dryRun ?? false,
			items: input.items,
			path: input.path,
			profileId: input.profileId,
		},
	});
	return toImportResult(body);
}

export function exportAgentSyncBundle(
	target: ApiTarget,
	input: {
		destination: string;
		dryRun?: boolean;
		includeAgents?: boolean;
		includeConversations?: boolean;
		includeSkills?: boolean;
		profileId?: string;
	}
): Promise<AgentSyncExportResult> {
	return request<AgentSyncExportResult>(target, "/api/agent-sync/export", {
		method: "POST",
		body: {
			destination: input.destination,
			dryRun: input.dryRun ?? false,
			includeAgents: input.includeAgents ?? true,
			includeConversations: input.includeConversations ?? true,
			includeSkills: input.includeSkills ?? true,
			profileId: input.profileId,
		},
	});
}

export function resumeAgentSyncAcpSession(
	target: ApiTarget,
	conversationId: string
): Promise<AgentSyncResumeResult> {
	return request<AgentSyncResumeResult>(target, "/api/agent-sync/acp/resume", {
		method: "POST",
		body: { conversationId },
	});
}

export function getAgentSyncStatus(
	target: ApiTarget
): Promise<AgentSyncStatus> {
	return request<AgentSyncStatus>(target, "/api/agent-sync/status");
}

export function resolveAgentSyncConflict(
	target: ApiTarget,
	input: {
		itemId: string;
		kind: string;
		profileId: string;
		resolution: "keep_external" | "keep_ryu";
	}
): Promise<{ resolved: boolean }> {
	return request<{ resolved: boolean }>(
		target,
		"/api/agent-sync/conflicts/resolve",
		{
			method: "PUT",
			body: {
				itemId: input.itemId,
				kind: input.kind,
				profileId: input.profileId,
				resolution: input.resolution,
			},
		}
	);
}
