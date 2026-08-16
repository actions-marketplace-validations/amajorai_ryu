import { type ApiTarget, request } from "./client.ts";

export interface BackgroundProcess {
	process_id: string;
	shell_id?: string | null;
	producer: string;
	kind: string;
	label?: string | null;
	description?: string | null;
	command: string;
	cwd: string;
	pid?: number | null;
	started_at: number;
	elapsed_ms: number;
	running: boolean;
	exit_code?: number | null;
	exit_signal?: string | null;
}

interface BackgroundProcessListResponse {
	processes?: BackgroundProcess[];
}

interface BackgroundProcessStopResponse {
	ok: boolean;
	requested: boolean;
	process_id: string;
}

export async function listBackgroundProcesses(
	target: ApiTarget,
	runningOnly = true
): Promise<BackgroundProcess[]> {
	const response = await request<BackgroundProcessListResponse>(
		target,
		`/api/background/processes?running_only=${runningOnly ? "true" : "false"}`
	);
	return Array.isArray(response.processes) ? response.processes : [];
}

export function requestStopBackgroundProcess(
	target: ApiTarget,
	processId: string
): Promise<BackgroundProcessStopResponse> {
	return request<BackgroundProcessStopResponse>(
		target,
		`/api/background/processes/${encodeURIComponent(processId)}/stop`,
		{ method: "POST", body: {} }
	);
}
