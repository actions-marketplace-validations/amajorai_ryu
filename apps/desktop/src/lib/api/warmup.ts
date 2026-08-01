// apps/desktop/src/lib/api/warmup.ts
//
// The composites behind the `warmup:crud` bridge capability, for the
// `@ryu/warmup` companion. Following the monitors/calendar pattern, the host
// holds the node token and drives Core's existing endpoints; the sandboxed frame
// never fetches anything itself.
//
// Nothing here is Warmup-specific inside Core: detection is `GET /api/agents` +
// `GET /api/agents/:id/usage` + `GET /api/agents/:id/acp-config`, and scheduling
// is `POST`/`DELETE /heartbeat/jobs`. The app is a configurator over the
// scheduler; Core's tick loop is what actually runs the pings.

import { fetchAcpConfig } from "./acp.ts";
import { fetchAgents } from "./agents.ts";
import type { ApiTarget } from "./client.ts";
import {
	createJob,
	deleteJob,
	fetchJobs,
	type JobInput,
	runJobNow,
	type ScheduledJob,
} from "./schedules.ts";
import { fetchAgentUsage, supportsUsage } from "./usage.ts";

/** The manifest id stamped on every job this app creates. */
export const WARMUP_APP_ID = "@ryu/warmup";

/** One model an agent advertises (the ACP `availableModels` entry). */
export interface WarmupModel {
	description: string | null;
	modelId: string;
	name: string;
}

/** One rolling window an agent reports. */
export interface WarmupWindow {
	label: string;
	resetsAt: string | null;
	usedPercent: number;
	windowSeconds: number | null;
}

/** A subscription agent, with everything needed to schedule a warmup for it. */
export interface WarmupAgent {
	available: boolean;
	id: string;
	models: WarmupModel[];
	name: string;
	plan: string | null;
	reason: string | null;
	windows: WarmupWindow[];
}

/** What {@link detectWarmupAgents} reports. */
export interface WarmupDetection {
	agents: WarmupAgent[];
	tz: string;
}

/**
 * The node's IANA zone. `Intl` is the only source that already accounts for the
 * host's DST rules, and it returns exactly the name Core's `chrono-tz` parses.
 */
function nodeTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

/**
 * The agents worth warming up, with their live usage windows and advertised
 * models.
 *
 * `supportsUsage` filters the candidate list so we don't probe every agent on
 * the node — but it is only a filter: an agent that passes it and then answers
 * `available: false` is still listed, because "signed out" is a state the user
 * can fix and hiding it would look like the agent does not exist. Usage and ACP
 * config are fetched per agent and failures degrade to an empty result rather
 * than failing the whole detection.
 */
export async function detectWarmupAgents(
	target: ApiTarget
): Promise<WarmupDetection> {
	const agents = await fetchAgents(target);
	const candidates = agents.filter((agent) => supportsUsage(agent.id));

	const detected = await Promise.all(
		candidates.map(async (agent): Promise<WarmupAgent> => {
			const [usage, config] = await Promise.all([
				fetchAgentUsage(target, agent.id).catch(() => null),
				fetchAcpConfig(target, agent.id).catch(() => null),
			]);
			return {
				id: agent.id,
				name: agent.name,
				available: usage?.available ?? false,
				plan: usage?.plan ?? null,
				reason: usage?.reason ?? (usage ? null : "error"),
				windows: (usage?.windows ?? []).map((w) => ({
					label: w.label,
					usedPercent: w.usedPercent,
					resetsAt: w.resetsAt,
					windowSeconds: w.windowSeconds,
				})),
				models: (config?.models?.availableModels ?? []).map((m) => ({
					modelId: m.modelId,
					name: m.name,
					description: m.description ?? null,
				})),
			};
		})
	);

	return { agents: detected, tz: nodeTimeZone() };
}

/**
 * Replace this app's scheduled jobs with `jobs`.
 *
 * Core has no update route, so this deletes every job owned by
 * {@link WARMUP_APP_ID} and creates the given set. Deletion runs first and is
 * scoped by `ownerApp`, so a job Core or another App owns is never touched — the
 * frame supplies only the schedule and target; the owner id is stamped here.
 *
 * A create failure propagates Core's own validation message (bad cron, unknown
 * zone). The already-deleted jobs stay deleted; the app refetches after every
 * apply, so what it shows is what actually survived rather than what it asked
 * for.
 */
export async function applyWarmupJobs(
	target: ApiTarget,
	jobs: Omit<JobInput, "enabled" | "ownerApp">[]
): Promise<void> {
	const existing = await fetchJobs(target);
	for (const job of existing) {
		if (job.ownerApp === WARMUP_APP_ID) {
			await deleteJob(target, job.id);
		}
	}
	for (const job of jobs) {
		await createJob(target, {
			...job,
			enabled: true,
			ownerApp: WARMUP_APP_ID,
		});
	}
}

/** Every scheduled job on the node, so the app can find the ones it owns. */
export function listWarmupJobs(target: ApiTarget): Promise<ScheduledJob[]> {
	return fetchJobs(target);
}

/**
 * Run one of this app's scheduled pings now.
 *
 * Scoped to jobs the app owns: the capability is "manage my warmup pings", and
 * without this check it would silently become "run any automation on this node",
 * which is a strictly larger power than anything else the grant confers.
 */
export async function runWarmupJobNow(
	target: ApiTarget,
	jobId: string
): Promise<void> {
	const jobs = await fetchJobs(target);
	const job = jobs.find((j) => j.id === jobId);
	if (!job || job.ownerApp !== WARMUP_APP_ID) {
		throw new Error("That ping is no longer scheduled.");
	}
	await runJobNow(target, jobId);
}
