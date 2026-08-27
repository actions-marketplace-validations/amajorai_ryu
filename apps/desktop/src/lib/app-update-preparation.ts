import { invoke } from "@tauri-apps/api/core";

export type AppUpdateSource =
	| { kind: "stable" }
	| { channel: "beta" | "canary" | "nightly"; kind: "channel" }
	| { channel: "beta" | "stable"; kind: "tag"; tag: string };

export interface PrepareAppUpdateRequest {
	expectedVersion: string;
	source: AppUpdateSource;
}

export interface PreparedAppUpdate {
	artifactFile: string;
	artifactSize: number;
	schemaVersion: 1;
	signature: string;
	source: AppUpdateSource;
	version: string;
}

export type PreparedAppUpdateSnapshot =
	| { kind: "empty" }
	| { kind: "loading" }
	| { kind: "ready"; update: PreparedAppUpdate };

type InvokeNative = (
	command: string,
	args?: Record<string, unknown>
) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSource(value: unknown): AppUpdateSource | null {
	if (!(isRecord(value) && typeof value.kind === "string")) {
		return null;
	}
	switch (value.kind) {
		case "stable":
			return { kind: "stable" };
		case "channel":
			if (
				value.channel === "beta" ||
				value.channel === "canary" ||
				value.channel === "nightly"
			) {
				return { channel: value.channel, kind: "channel" };
			}
			return null;
		case "tag":
			if (
				(value.channel === "beta" || value.channel === "stable") &&
				typeof value.tag === "string" &&
				value.tag.length > 0
			) {
				return { channel: value.channel, kind: "tag", tag: value.tag };
			}
			return null;
		default:
			return null;
	}
}

function parsePreparedAppUpdate(value: unknown): PreparedAppUpdate | null {
	if (!isRecord(value)) {
		return null;
	}
	const source = parseSource(value.source);
	if (
		value.schemaVersion !== 1 ||
		typeof value.version !== "string" ||
		value.version.length === 0 ||
		typeof value.signature !== "string" ||
		value.signature.length === 0 ||
		typeof value.artifactFile !== "string" ||
		value.artifactFile.length === 0 ||
		value.artifactFile.includes("/") ||
		value.artifactFile.includes("\\") ||
		typeof value.artifactSize !== "number" ||
		!Number.isSafeInteger(value.artifactSize) ||
		value.artifactSize < 0 ||
		source === null
	) {
		return null;
	}
	return {
		artifactFile: value.artifactFile,
		artifactSize: value.artifactSize,
		schemaVersion: 1,
		signature: value.signature,
		source,
		version: value.version,
	};
}

function parsePreparedResult(value: unknown): PreparedAppUpdate | null {
	if (value === null || value === undefined) {
		return null;
	}
	const prepared = parsePreparedAppUpdate(value);
	if (!prepared) {
		throw new Error("Invalid prepared app update returned by Tauri");
	}
	return prepared;
}

export class AppUpdatePreparationCoordinator {
	private readonly inFlight = new Map<
		string,
		Promise<PreparedAppUpdate | null>
	>();
	private readonly listeners = new Set<() => void>();
	private snapshot: PreparedAppUpdateSnapshot = { kind: "loading" };

	constructor(private readonly invokeNative: InvokeNative) {}

	getSnapshot = (): PreparedAppUpdateSnapshot => this.snapshot;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	private setSnapshot(snapshot: PreparedAppUpdateSnapshot): void {
		this.snapshot = snapshot;
		for (const listener of this.listeners) {
			listener();
		}
	}

	async getAutomaticDownload(): Promise<boolean> {
		try {
			const value = await this.invokeNative(
				"get_app_update_download_preference"
			);
			return typeof value === "boolean" ? value : true;
		} catch {
			return true;
		}
	}

	async setAutomaticDownload(enabled: boolean): Promise<boolean> {
		try {
			await this.invokeNative("set_app_update_download_preference", {
				enabled,
			});
			return true;
		} catch {
			return false;
		}
	}

	async refresh(): Promise<PreparedAppUpdate | null> {
		const value = await this.invokeNative("get_prepared_app_update");
		const prepared = parsePreparedResult(value);
		this.setSnapshot(
			prepared ? { kind: "ready", update: prepared } : { kind: "empty" }
		);
		return prepared;
	}

	prepare(request: PrepareAppUpdateRequest): Promise<PreparedAppUpdate | null> {
		const key = JSON.stringify(request);
		const existing = this.inFlight.get(key);
		if (existing) {
			return existing;
		}
		const operation = this.invokeNative("prepare_app_update", { request })
			.then(parsePreparedResult)
			.then((prepared) => {
				this.setSnapshot(
					prepared ? { kind: "ready", update: prepared } : { kind: "empty" }
				);
				return prepared;
			})
			.finally(() => {
				if (this.inFlight.get(key) === operation) {
					this.inFlight.delete(key);
				}
			});
		this.inFlight.set(key, operation);
		return operation;
	}

	async install(): Promise<boolean> {
		const value = await this.invokeNative("install_prepared_app_update");
		if (value !== true && value !== false) {
			throw new Error("Invalid prepared app update install result from Tauri");
		}
		if (value) {
			this.setSnapshot({ kind: "empty" });
		}
		return value;
	}

	async clear(): Promise<boolean> {
		try {
			await this.invokeNative("clear_prepared_app_update");
			this.setSnapshot({ kind: "empty" });
			return true;
		} catch {
			return false;
		}
	}
}

export function createAppUpdatePreparationCoordinator(
	invokeNative: InvokeNative
): AppUpdatePreparationCoordinator {
	return new AppUpdatePreparationCoordinator(invokeNative);
}

const coordinator = createAppUpdatePreparationCoordinator((command, args) =>
	invoke<unknown>(command, args)
);

export const getAutomaticAppUpdateDownload = (): Promise<boolean> =>
	coordinator.getAutomaticDownload();
export const setAutomaticAppUpdateDownload = (
	enabled: boolean
): Promise<boolean> => coordinator.setAutomaticDownload(enabled);
export const getPreparedAppUpdate = (): Promise<PreparedAppUpdate | null> =>
	coordinator.refresh();
export const prepareAppUpdate = (
	request: PrepareAppUpdateRequest
): Promise<PreparedAppUpdate | null> => coordinator.prepare(request);
export const installPreparedAppUpdate = (): Promise<boolean> =>
	coordinator.install();
export const clearPreparedAppUpdate = (): Promise<boolean> =>
	coordinator.clear();
export const subscribePreparedAppUpdate = (
	listener: () => void
): (() => void) => coordinator.subscribe(listener);
export const getPreparedAppUpdateSnapshot = (): PreparedAppUpdateSnapshot =>
	coordinator.getSnapshot();
