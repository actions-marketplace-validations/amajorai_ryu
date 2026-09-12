/** Host-owned microphone capture. The app sees opaque IDs, never device file paths. */
export type MediaRecordingInput =
	| { action: "status" }
	| { action: "start" }
	| { action: "rewind"; id: string; seconds: 15 | 300 }
	| { action: "stop" | "read" | "discard" | "ack"; id: string };

export interface MediaRecordingResult {
	audio?: string;
	available: boolean;
	background: boolean;
	chunkId?: string;
	chunkStartedAt?: string;
	continuous?: boolean;
	durationMs?: number;
	filename?: string;
	id?: string;
	message?: string;
	pendingChunks?: number;
	startedAt?: string;
	state: "idle" | "recording" | "pending";
}

export function parseMediaRecordingInput(
	value: unknown
): MediaRecordingInput | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const input = value as Record<string, unknown>;
	if (
		Object.keys(input).some(
			(key) => key !== "action" && key !== "id" && key !== "seconds"
		)
	) {
		return null;
	}
	if (input.action === "status" || input.action === "start") {
		return input.id === undefined && input.seconds === undefined
			? { action: input.action }
			: null;
	}
	if (
		input.action === "rewind" &&
		typeof input.id === "string" &&
		/^[a-zA-Z0-9-]{1,80}$/.test(input.id) &&
		(input.seconds === 15 || input.seconds === 300)
	) {
		return { action: "rewind", id: input.id, seconds: input.seconds };
	}
	if (
		(input.action === "ack" ||
			input.action === "stop" ||
			input.action === "read" ||
			input.action === "discard") &&
		typeof input.id === "string" &&
		input.seconds === undefined &&
		/^[a-zA-Z0-9-]{1,80}$/.test(input.id)
	) {
		return { action: input.action, id: input.id };
	}
	return null;
}

export type MediaRecordingService = (
	input: MediaRecordingInput
) => Promise<MediaRecordingResult>;
