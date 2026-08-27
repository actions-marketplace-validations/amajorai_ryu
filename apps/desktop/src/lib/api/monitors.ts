// apps/desktop/src/lib/api/monitors.ts
//
// Typed client for the Core website-monitoring API (`/api/monitors/*`). Field
// names are snake_case to match Core's serde shapes exactly (the Rust structs
// use no rename). The alert SSE stream uses fetch + ReadableStream rather than
// EventSource so the bearer token can be attached.

import { type ApiTarget, request } from "./client.ts";
import { streamChannel } from "./eventStream.ts";

export type {
	Alert,
	CheckStatus,
	CheckType,
	FetchBackend,
	Monitor,
	MonitorInput,
	NotifyTarget,
	NumComparator,
	Snapshot,
} from "@ryuhq/core-client/monitors";

import type {
	Alert,
	CheckStatus,
	Monitor,
	MonitorInput,
	Snapshot,
} from "@ryuhq/core-client/monitors";

export async function listMonitors(target: ApiTarget): Promise<Monitor[]> {
	const json = await request<{ monitors?: Monitor[] }>(target, "/api/monitors");
	return json.monitors ?? [];
}

export async function getMonitor(
	target: ApiTarget,
	id: string
): Promise<Monitor> {
	const json = await request<{ monitor?: Monitor; error?: string }>(
		target,
		`/api/monitors/${id}`
	);
	if (!json.monitor) {
		throw new Error(json.error ?? "monitor not found");
	}
	return json.monitor;
}

export async function createMonitor(
	target: ApiTarget,
	data: MonitorInput
): Promise<Monitor> {
	const json = await request<{ monitor?: Monitor; error?: string }>(
		target,
		"/api/monitors",
		{ method: "POST", body: data }
	);
	if (!json.monitor) {
		throw new Error(json.error ?? "failed to create monitor");
	}
	return json.monitor;
}

export async function updateMonitor(
	target: ApiTarget,
	id: string,
	data: MonitorInput
): Promise<Monitor> {
	const json = await request<{ monitor?: Monitor; error?: string }>(
		target,
		`/api/monitors/${id}`,
		{ method: "PUT", body: data }
	);
	if (!json.monitor) {
		throw new Error(json.error ?? "failed to update monitor");
	}
	return json.monitor;
}

export async function deleteMonitor(
	target: ApiTarget,
	id: string
): Promise<void> {
	await request(target, `/api/monitors/${id}`, { method: "DELETE" });
}

export async function runMonitor(
	target: ApiTarget,
	id: string
): Promise<CheckStatus> {
	const json = await request<{ status?: CheckStatus; error?: string }>(
		target,
		`/api/monitors/${id}/run`,
		{ method: "POST" }
	);
	if (!json.status) {
		throw new Error(json.error ?? "check failed");
	}
	return json.status;
}

export async function listSnapshots(
	target: ApiTarget,
	id: string,
	limit = 50
): Promise<Snapshot[]> {
	const json = await request<{ snapshots?: Snapshot[] }>(
		target,
		`/api/monitors/${id}/snapshots?limit=${limit}`
	);
	return json.snapshots ?? [];
}

export async function listMonitorAlerts(
	target: ApiTarget,
	id: string,
	limit = 100
): Promise<Alert[]> {
	const json = await request<{ alerts?: Alert[] }>(
		target,
		`/api/monitors/${id}/alerts?limit=${limit}`
	);
	return json.alerts ?? [];
}

export async function listAllAlerts(
	target: ApiTarget,
	limit = 100
): Promise<Alert[]> {
	const json = await request<{ alerts?: Alert[] }>(
		target,
		`/api/monitors/alerts?limit=${limit}`
	);
	return json.alerts ?? [];
}

export async function ackAlert(target: ApiTarget, id: number): Promise<void> {
	await request(target, `/api/monitors/alerts/${id}/ack`, { method: "POST" });
}

/**
 * Subscribe to monitor alert events and invoke `onAlert` for every event.
 * Resolves when `signal` aborts. Shares the single multiplexed node connection
 * (`/api/events/all`, see eventStream.ts) instead of its own HTTP socket.
 */
export function streamMonitorAlerts(
	target: ApiTarget,
	onAlert: (alert: Alert) => void,
	signal?: AbortSignal
): Promise<void> {
	return streamChannel(target, "monitors", onAlert, signal);
}
