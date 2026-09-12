import { type ApiTarget, request } from "@ryuhq/core-client/client";
import { fetchSidecarStatus } from "@ryuhq/core-client/system";

interface SetupListWire {
	installed?: string[];
}
interface SetupStatusWire {
	states?: Record<string, { state?: string } | undefined>;
}
export interface ServicesSnapshot {
	installed: Set<string>;
	installStates: Record<string, string>;
	offline: boolean;
	running: Set<string>;
}

/** Independent probes share one view lifetime and retain partial failure semantics. */
export async function loadServices(
	target: ApiTarget,
	signal?: AbortSignal
): Promise<ServicesSnapshot> {
	signal?.throwIfAborted();
	const [runningResult, installedResult, statesResult] =
		await Promise.allSettled([
			fetchSidecarStatus(target, signal),
			request<SetupListWire>(target, "/api/setup/list", { signal }),
			request<SetupStatusWire>(target, "/api/setup/status", { signal }),
		]);
	signal?.throwIfAborted();
	const running = new Set<string>();
	if (runningResult.status === "fulfilled") {
		for (const [name, isRunning] of Object.entries(runningResult.value)) {
			if (isRunning) {
				running.add(name);
			}
		}
	}
	const listed =
		installedResult.status === "fulfilled"
			? installedResult.value?.installed
			: undefined;
	const installed = new Set(
		Array.isArray(listed)
			? listed.filter((name) => typeof name === "string")
			: []
	);
	const installStates: Record<string, string> = {};
	if (statesResult.status === "fulfilled") {
		for (const [name, value] of Object.entries(
			statesResult.value?.states ?? {}
		)) {
			if (value?.state) {
				installStates[name] = value.state;
			}
		}
	}
	return {
		running,
		installed,
		installStates,
		offline: runningResult.status === "rejected" && installed.size === 0,
	};
}
