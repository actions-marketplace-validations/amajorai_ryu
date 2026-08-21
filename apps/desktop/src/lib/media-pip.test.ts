import { afterEach, expect, test } from "bun:test";
import {
	clearMediaSource,
	getMediaSourceSnapshot,
	mediaRecordingSource,
	publishMediaSource,
	subscribeMediaSource,
} from "./media-pip.ts";

afterEach(() => {
	clearMediaSource();
});

test("publishes the active media source and notifies subscribers", () => {
	let notifications = 0;
	const unsubscribe = subscribeMediaSource(() => {
		notifications += 1;
	});

	publishMediaSource({
		id: "browser:tab-1",
		imageUrl: "data:image/png;base64,proof",
		kind: "browser",
		title: "Docs tab",
	});

	expect(getMediaSourceSnapshot()).toMatchObject({
		id: "browser:tab-1",
		kind: "browser",
		title: "Docs tab",
	});
	expect(notifications).toBe(1);

	unsubscribe();
});

test("a stale source cannot clear the current active source", () => {
	publishMediaSource({
		id: "desktop:node-1",
		imageUrl: "data:image/jpeg;base64,proof",
		kind: "desktop",
		title: "Remote desktop",
	});

	clearMediaSource("browser:tab-1");

	expect(getMediaSourceSnapshot()?.id).toBe("desktop:node-1");
});

test("normalizes evidence recording details for the shared media dock", () => {
	expect(
		mediaRecordingSource({
			id: "recording-1",
			title: "  Checkout evidence  ",
			url: "  https://example.test/evidence.webm  ",
		})
	).toEqual({
		id: "recording-1",
		kind: "recording",
		title: "Checkout evidence",
		videoUrl: "https://example.test/evidence.webm",
	});

	expect(mediaRecordingSource({ id: "missing-url", url: "  " })).toBeNull();
});
