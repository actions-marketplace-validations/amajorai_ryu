import type { ApiTarget } from "./client.ts";
import { request } from "./client.ts";

export interface PromptSuiteRecord {
	agentId: string;
	config: Record<string, unknown>;
	createdAt: number;
	id: string;
	name: string;
	updatedAt: number;
}

export interface PromptSuiteVersionMeta {
	createdAt: number;
	id: string;
	label: string | null;
	suiteId: string;
}

export interface PromptSuiteVersion extends PromptSuiteVersionMeta {
	config: Record<string, unknown>;
}

export interface PromptRunMeta {
	createdAt: number;
	id: string;
	name: string;
	suiteId: string;
}

export interface PromptRun extends PromptRunMeta {
	request: Record<string, unknown>;
	result: Record<string, unknown>;
}

export interface PromptReview {
	comment: string | null;
	highlighted: boolean;
	pass: boolean | null;
	resultKey: string;
	runId: string;
	score: number | null;
	updatedAt: number;
}

interface PromptSuiteWire {
	agent_id: string;
	config: Record<string, unknown>;
	created_at: number;
	id: string;
	name: string;
	updated_at: number;
}

interface PromptSuiteVersionWire {
	config?: Record<string, unknown>;
	created_at: number;
	id: string;
	label?: string | null;
	suite_id: string;
}

interface PromptRunMetaWire {
	created_at: number;
	id: string;
	name: string;
	suite_id: string;
}

interface PromptRunWire extends PromptRunMetaWire {
	request: Record<string, unknown>;
	result: Record<string, unknown>;
}

interface PromptReviewWire {
	comment?: string | null;
	highlighted?: boolean;
	pass?: boolean | null;
	result_key: string;
	run_id: string;
	score?: number | null;
	updated_at: number;
}

function toSuite(value: PromptSuiteWire): PromptSuiteRecord {
	return {
		agentId: value.agent_id,
		config: value.config,
		createdAt: value.created_at,
		id: value.id,
		name: value.name,
		updatedAt: value.updated_at,
	};
}

function toVersion(value: PromptSuiteVersionWire): PromptSuiteVersion {
	return {
		config: value.config ?? {},
		createdAt: value.created_at,
		id: value.id,
		label: value.label ?? null,
		suiteId: value.suite_id,
	};
}

function toRunMeta(value: PromptRunMetaWire): PromptRunMeta {
	return {
		createdAt: value.created_at,
		id: value.id,
		name: value.name,
		suiteId: value.suite_id,
	};
}

function toRun(value: PromptRunWire): PromptRun {
	return {
		...toRunMeta(value),
		request: value.request,
		result: value.result,
	};
}

function toReview(value: PromptReviewWire): PromptReview {
	return {
		comment: value.comment ?? null,
		highlighted: value.highlighted ?? false,
		pass: value.pass ?? null,
		resultKey: value.result_key,
		runId: value.run_id,
		score: value.score ?? null,
		updatedAt: value.updated_at,
	};
}

export async function listPromptSuites(
	target: ApiTarget,
	agentId: string
): Promise<PromptSuiteRecord[]> {
	const json = await request<{ suites?: PromptSuiteWire[] }>(
		target,
		`/api/prompt-suites?agent_id=${encodeURIComponent(agentId)}`
	);
	return (json.suites ?? []).map(toSuite);
}

export async function createPromptSuite(
	target: ApiTarget,
	input: {
		agentId: string;
		config: Record<string, unknown>;
		label?: string;
		name: string;
	}
): Promise<{
	suite: PromptSuiteRecord;
	version: PromptSuiteVersionMeta | null;
}> {
	const json = await request<{
		suite: PromptSuiteWire;
		version?: PromptSuiteVersionWire | null;
	}>(target, "/api/prompt-suites", {
		body: {
			agent_id: input.agentId,
			config: input.config,
			...(input.label?.trim() ? { label: input.label.trim() } : {}),
			name: input.name,
		},
		method: "POST",
	});
	return {
		suite: toSuite(json.suite),
		version: json.version ? toVersion(json.version) : null,
	};
}

export async function getPromptSuite(
	target: ApiTarget,
	suiteId: string
): Promise<PromptSuiteRecord> {
	const json = await request<{ suite: PromptSuiteWire }>(
		target,
		`/api/prompt-suites/${encodeURIComponent(suiteId)}`
	);
	return toSuite(json.suite);
}

export async function updatePromptSuite(
	target: ApiTarget,
	suiteId: string,
	input: { config: Record<string, unknown>; label?: string; name: string }
): Promise<{
	suite: PromptSuiteRecord;
	version: PromptSuiteVersionMeta | null;
}> {
	const json = await request<{
		suite: PromptSuiteWire;
		version?: PromptSuiteVersionWire | null;
	}>(target, `/api/prompt-suites/${encodeURIComponent(suiteId)}`, {
		body: {
			config: input.config,
			...(input.label?.trim() ? { label: input.label.trim() } : {}),
			name: input.name,
		},
		method: "PUT",
	});
	return {
		suite: toSuite(json.suite),
		version: json.version ? toVersion(json.version) : null,
	};
}

export async function deletePromptSuite(
	target: ApiTarget,
	suiteId: string
): Promise<void> {
	await request(target, `/api/prompt-suites/${encodeURIComponent(suiteId)}`, {
		method: "DELETE",
	});
}

export async function listPromptSuiteVersions(
	target: ApiTarget,
	suiteId: string
): Promise<PromptSuiteVersionMeta[]> {
	const json = await request<{ versions?: PromptSuiteVersionWire[] }>(
		target,
		`/api/prompt-suites/${encodeURIComponent(suiteId)}/versions`
	);
	return (json.versions ?? []).map((version) => ({
		createdAt: version.created_at,
		id: version.id,
		label: version.label ?? null,
		suiteId: version.suite_id,
	}));
}

export async function getPromptSuiteVersion(
	target: ApiTarget,
	suiteId: string,
	versionId: string
): Promise<PromptSuiteVersion> {
	const json = await request<{ version: PromptSuiteVersionWire }>(
		target,
		`/api/prompt-suites/${encodeURIComponent(suiteId)}/versions/${encodeURIComponent(versionId)}`
	);
	return toVersion(json.version);
}

export async function createPromptSuiteVersion(
	target: ApiTarget,
	suiteId: string,
	label?: string
): Promise<PromptSuiteVersionMeta> {
	const json = await request<{ version: PromptSuiteVersionWire }>(
		target,
		`/api/prompt-suites/${encodeURIComponent(suiteId)}/versions`,
		{
			body: label?.trim() ? { label: label.trim() } : {},
			method: "POST",
		}
	);
	return toVersion(json.version);
}

export async function restorePromptSuiteVersion(
	target: ApiTarget,
	suiteId: string,
	versionId: string
): Promise<PromptSuiteRecord> {
	const json = await request<{ suite: PromptSuiteWire }>(
		target,
		`/api/prompt-suites/${encodeURIComponent(suiteId)}/versions/${encodeURIComponent(versionId)}/restore`,
		{ method: "POST" }
	);
	return toSuite(json.suite);
}

export async function listPromptRuns(
	target: ApiTarget,
	suiteId: string
): Promise<PromptRunMeta[]> {
	const json = await request<{ runs?: PromptRunMetaWire[] }>(
		target,
		`/api/prompt-suites/${encodeURIComponent(suiteId)}/runs`
	);
	return (json.runs ?? []).map(toRunMeta);
}

export async function savePromptRun(
	target: ApiTarget,
	suiteId: string,
	input: {
		name: string;
		request: Record<string, unknown>;
		result: Record<string, unknown>;
	}
): Promise<PromptRunMeta> {
	const json = await request<{ run: PromptRunMetaWire }>(
		target,
		`/api/prompt-suites/${encodeURIComponent(suiteId)}/runs`,
		{ body: input, method: "POST" }
	);
	return toRunMeta(json.run);
}

export async function getPromptRun(
	target: ApiTarget,
	suiteId: string,
	runId: string
): Promise<PromptRun> {
	const json = await request<{ run: PromptRunWire }>(
		target,
		`/api/prompt-suites/${encodeURIComponent(suiteId)}/runs/${encodeURIComponent(runId)}`
	);
	return toRun(json.run);
}

export async function listPromptReviews(
	target: ApiTarget,
	suiteId: string,
	runId: string
): Promise<PromptReview[]> {
	const json = await request<{ reviews?: PromptReviewWire[] }>(
		target,
		`/api/prompt-suites/${encodeURIComponent(suiteId)}/runs/${encodeURIComponent(runId)}/reviews`
	);
	return (json.reviews ?? []).map(toReview);
}

export async function savePromptReview(
	target: ApiTarget,
	suiteId: string,
	runId: string,
	input: {
		comment?: string;
		highlighted?: boolean;
		pass?: boolean | null;
		resultKey: string;
		score?: number | null;
	}
): Promise<PromptReview> {
	const json = await request<{ review: PromptReviewWire }>(
		target,
		`/api/prompt-suites/${encodeURIComponent(suiteId)}/runs/${encodeURIComponent(runId)}/reviews`,
		{
			body: {
				...(input.comment === undefined ? {} : { comment: input.comment }),
				highlighted: input.highlighted ?? false,
				pass: input.pass ?? null,
				result_key: input.resultKey,
				score: input.score ?? null,
			},
			method: "POST",
		}
	);
	return toReview(json.review);
}
