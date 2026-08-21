import { describe, expect, it } from "bun:test";
import {
	AmbientAudioController,
	clampAmbientVolume,
} from "./ambient-agent-audio.ts";

interface FakeAudio {
	currentTime: number;
	load: () => void;
	loop: boolean;
	pause: () => void;
	pauseCount: number;
	paused: boolean;
	play: () => Promise<void>;
	playCount: number;
	preload: string;
	src: string;
	volume: number;
}

function makeFakeAudio(source: string): FakeAudio {
	return {
		currentTime: 0,
		load: () => undefined,
		loop: false,
		pause() {
			this.pauseCount += 1;
			this.paused = true;
		},
		pauseCount: 0,
		paused: true,
		async play() {
			this.playCount += 1;
			this.paused = false;
		},
		playCount: 0,
		preload: "",
		src: source,
		volume: 0,
	};
}

describe("AmbientAudioController", () => {
	it("reuses one player across syncs and stops cleanly", () => {
		const created: FakeAudio[] = [];
		const controller = new AmbientAudioController((source) => {
			const audio = makeFakeAudio(source);
			created.push(audio);
			return audio as unknown as HTMLAudioElement;
		});

		controller.sync({
			playing: true,
			source: "/sounds/elevator-4.mp3",
			volume: 0.35,
		});
		controller.sync({
			playing: true,
			source: "/sounds/elevator-4.mp3",
			volume: 0.5,
		});

		expect(created).toHaveLength(1);
		expect(created[0]?.playCount).toBe(1);
		expect(created[0]?.volume).toBe(0.5);

		controller.sync({
			playing: false,
			source: "/sounds/elevator-4.mp3",
			volume: 0.5,
		});
		expect(created[0]?.pauseCount).toBe(1);
		expect(created[0]?.currentTime).toBe(0);

		controller.sync({
			playing: true,
			source: "/sounds/elevator-4.mp3",
			volume: 0.5,
		});
		expect(created).toHaveLength(1);
		expect(created[0]?.playCount).toBe(2);
	});

	it("clamps invalid and out-of-range volume", () => {
		expect(clampAmbientVolume(Number.NaN)).toBe(0);
		expect(clampAmbientVolume(-1)).toBe(0);
		expect(clampAmbientVolume(2)).toBe(1);
	});
});
