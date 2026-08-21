/**
 * Cross-window live-media state.
 *
 * The main workspace owns the source (browser tab, remote desktop, or evidence
 * recording). The native `media-pip` Tauri window is a separate webview, so a
 * small BroadcastChannel keeps it in sync without making either renderer own the
 * other's React tree.
 */

export const MEDIA_RECORDING_EVENT = "ryu:media-recording";

export type MediaSourceKind =
	| "agent-browser"
	| "browser"
	| "desktop"
	| "recording";

export interface MediaSource {
	id: string;
	imageUrl?: string;
	kind: MediaSourceKind;
	posterUrl?: string;
	tabId?: string;
	title: string;
	updatedAt: number;
	videoUrl?: string;
}

export interface MediaRecordingDetail {
	id: string;
	posterUrl?: string;
	title?: string;
	url: string;
}

type MediaMessage =
	| { source: MediaSource; type: "source" }
	| { id?: string; type: "clear" }
	| { type: "request" };

const CHANNEL_NAME = "ryu:media-pip";

let activeSource: MediaSource | null = null;
let channel: BroadcastChannel | null = null;
const listeners = new Set<() => void>();

function isMediaSource(value: unknown): value is MediaSource {
	if (!value || typeof value !== "object") {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.id === "string" &&
		typeof candidate.title === "string" &&
		typeof candidate.updatedAt === "number" &&
		(candidate.kind === "agent-browser" ||
			candidate.kind === "browser" ||
			candidate.kind === "desktop" ||
			candidate.kind === "recording") &&
		(typeof candidate.imageUrl === "undefined" ||
			typeof candidate.imageUrl === "string") &&
		(typeof candidate.videoUrl === "undefined" ||
			typeof candidate.videoUrl === "string")
	);
}

function notify(): void {
	for (const listener of listeners) {
		listener();
	}
}

function receive(message: unknown): void {
	if (!message || typeof message !== "object") {
		return;
	}
	const candidate = message as Partial<MediaMessage>;
	if (candidate.type === "source" && isMediaSource(candidate.source)) {
		activeSource = candidate.source;
		notify();
		return;
	}
	if (candidate.type === "clear") {
		if (candidate.id && activeSource?.id !== candidate.id) {
			return;
		}
		activeSource = null;
		notify();
		return;
	}
	if (candidate.type === "request" && activeSource) {
		channel?.postMessage({
			source: activeSource,
			type: "source",
		} satisfies MediaMessage);
	}
}

function ensureChannel(): BroadcastChannel | null {
	if (
		channel ||
		typeof window === "undefined" ||
		!("BroadcastChannel" in window)
	) {
		return channel;
	}
	channel = new BroadcastChannel(CHANNEL_NAME);
	channel.addEventListener("message", (event: MessageEvent<unknown>) => {
		receive(event.data);
	});
	return channel;
}

export function getMediaSourceSnapshot(): MediaSource | null {
	return activeSource;
}

export function subscribeMediaSource(listener: () => void): () => void {
	ensureChannel();
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function requestMediaSource(): void {
	ensureChannel()?.postMessage({ type: "request" } satisfies MediaMessage);
}

export function publishMediaSource(
	source: Omit<MediaSource, "updatedAt"> & { updatedAt?: number }
): void {
	activeSource = {
		...source,
		updatedAt: source.updatedAt ?? Date.now(),
	};
	notify();
	ensureChannel()?.postMessage({
		source: activeSource,
		type: "source",
	} satisfies MediaMessage);
}

export function clearMediaSource(sourceId?: string): void {
	if (sourceId && activeSource?.id !== sourceId) {
		return;
	}
	activeSource = null;
	notify();
	ensureChannel()?.postMessage({
		id: sourceId,
		type: "clear",
	} satisfies MediaMessage);
}

export function mediaRecordingSource(
	detail: unknown
): Omit<MediaSource, "updatedAt"> | null {
	if (!detail || typeof detail !== "object") {
		return null;
	}
	const candidate = detail as Partial<MediaRecordingDetail>;
	if (typeof candidate.id !== "string" || typeof candidate.url !== "string") {
		return null;
	}
	const url = candidate.url.trim();
	if (!url) {
		return null;
	}
	return {
		id: candidate.id,
		kind: "recording",
		posterUrl: candidate.posterUrl,
		title: candidate.title?.trim() || "Evidence recording",
		videoUrl: url,
	};
}
