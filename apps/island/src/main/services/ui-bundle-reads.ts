import type { PluginUiBundleResult } from "../../shared/ipc.ts";
import { pluginUiBundle } from "./plugin-host.ts";

interface ReadOwner {
	id: number;
	once(event: "destroyed", listener: () => void): unknown;
	removeListener(event: "destroyed", listener: () => void): unknown;
}
interface OwnerReads {
	destroyed: () => void;
	owner: ReadOwner;
	reads: Map<string, AbortController>;
}
const owners = new Map<number, OwnerReads>();
const UI_BUNDLE_CACHE_MS = 60_000;
interface CachedUiBundle {
	expiresAt: number;
	value: PluginUiBundleResult;
}
const uiBundleCache = new Map<string, CachedUiBundle>();

function cachedUiBundle(pluginId: string): PluginUiBundleResult | undefined {
	const entry = uiBundleCache.get(pluginId);
	if (!entry) {
		return undefined;
	}
	if (entry.expiresAt <= Date.now()) {
		uiBundleCache.delete(pluginId);
		return undefined;
	}
	return entry.value;
}

function rememberUiBundle(pluginId: string, value: PluginUiBundleResult): void {
	if (value.available && typeof value.code === "string") {
		uiBundleCache.set(pluginId, {
			expiresAt: Date.now() + UI_BUNDLE_CACHE_MS,
			value,
		});
	}
}

/** Cancellation is scoped to the IPC sender, never another window's request. */
export function abortUiBundleRead(ownerId: number, requestId: string): void {
	owners.get(ownerId)?.reads.get(requestId)?.abort();
}

export async function readUiBundle(
	owner: ReadOwner,
	pluginId: string,
	requestId?: string
): Promise<PluginUiBundleResult> {
	if (requestId === undefined) {
		const cached = cachedUiBundle(pluginId);
		if (cached) {
			return cached;
		}
		const value = await pluginUiBundle(pluginId);
		rememberUiBundle(pluginId, value);
		return value;
	}
	if (
		typeof requestId !== "string" ||
		requestId.length === 0 ||
		requestId.length > 128
	) {
		return { available: false, reason: "invalid request id" };
	}
	const cached = cachedUiBundle(pluginId);
	if (cached) {
		return cached;
	}
	let entry = owners.get(owner.id);
	if (!entry) {
		const reads = new Map<string, AbortController>();
		const destroyed = () => {
			for (const controller of reads.values()) {
				controller.abort();
			}
			owners.delete(owner.id);
		};
		entry = { owner, reads, destroyed };
		owners.set(owner.id, entry);
		owner.once("destroyed", destroyed);
	}
	if (entry.reads.has(requestId)) {
		return { available: false, reason: "duplicate request id" };
	}
	const controller = new AbortController();
	entry.reads.set(requestId, controller);
	try {
		const value = await pluginUiBundle(pluginId, controller.signal);
		rememberUiBundle(pluginId, value);
		return value;
	} finally {
		entry.reads.delete(requestId);
		if (entry.reads.size === 0) {
			entry.owner.removeListener("destroyed", entry.destroyed);
			if (owners.get(owner.id) === entry) {
				owners.delete(owner.id);
			}
		}
	}
}
