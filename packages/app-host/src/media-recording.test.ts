import { expect, test } from "bun:test";
import { parseMediaRecordingInput } from "./media-recording.ts";
import { capabilitiesFromGrants, dispatchRpc } from "./rpc.ts";

test("microphone action parser rejects path traversal and extra authority", () => {
	expect(
		parseMediaRecordingInput({ action: "read", id: "../../audio" })
	).toBeNull();
	expect(
		parseMediaRecordingInput({ action: "start", owner: "another-app" })
	).toBeNull();
	expect(parseMediaRecordingInput({ action: "discard" })).toBeNull();
	expect(
		parseMediaRecordingInput({ action: "stop", id: "recording-1" })
	).toEqual({ action: "stop", id: "recording-1" });
});
test("recording requires its own approved grant before requesting the OS microphone", async () => {
	let calls = 0;
	const services = {
		listAgents: async () => [],
		mediaRecording: async () => {
			calls += 1;
			return {
				available: true,
				background: false,
				state: "recording" as const,
			};
		},
		registerRoute: async () => ({}),
	};
	await expect(
		dispatchRpc(
			"media.recording",
			[{ action: "start" }],
			capabilitiesFromGrants(["media:transcribe"]),
			services
		)
	).rejects.toThrow();
	expect(calls).toBe(0);
	await dispatchRpc(
		"media.recording",
		[{ action: "start" }],
		capabilitiesFromGrants(["media:record"]),
		services
	);
	expect(calls).toBe(1);
});
test("missing capture implementation reports unavailable without claiming recording", async () => {
	expect(
		await dispatchRpc(
			"media.recording",
			[{ action: "status" }],
			capabilitiesFromGrants(["media:record"]),
			{ listAgents: async () => [], registerRoute: async () => ({}) }
		)
	).toMatchObject({ available: false, state: "idle" });
});
test("speech history rejects unbounded requests before touching Shadow", async () => {
	let called = false;
	const service = {
		listAgents: async () => [],
		registerRoute: async () => ({}),
		timelineTranscripts: async () => {
			called = true;
			return { segments: [], nextOffset: null };
		},
	};
	await expect(
		dispatchRpc(
			"timeline.transcripts",
			[{ start: "2026-01-01T00:00:00Z", end: "2026-09-12T00:00:00Z" }],
			capabilitiesFromGrants(["timeline:speech"]),
			service
		)
	).rejects.toThrow();
	expect(called).toBe(false);
});
