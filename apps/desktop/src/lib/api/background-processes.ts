import { type ApiTarget, request } from "./client.ts";

export interface BackgroundProcess {
	command: string;
	cwd: string;
	description?: string | null;
	elapsed_ms: number;
	exit_code?: number | null;
	exit_signal?: string | null;
	kind: string;
	label?: string | null;
	pid?: number | null;
	process_id: string;
	producer: string;
	running: boolean;
	shell_id?: string | null;
	started_at: number;
}

interface BackgroundProcessListResponse {
	processes?: BackgroundProcess[];
}

interface BackgroundProcessStopResponse {
	ok: boolean;
	process_id: string;
	requested: boolean;
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
