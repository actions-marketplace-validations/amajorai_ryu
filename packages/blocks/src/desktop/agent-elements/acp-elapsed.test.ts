// The regression this file exists for: an ACP turn's elapsed meter kept counting
// on turns that had already finished. Core only seals a turn with a `done:true`
// usage frame on the happy path — a failed turn, a Stop, or a Core restart
// leaves `done:false` on disk — so "not done" cannot mean "still running". The
// footer needs a second brake: whether this turn is the LIVE one.

import { describe, expect, test } from "bun:test";
import { resolveAcpElapsedMs } from "./acp-elapsed.ts";

const NOW = 10_000;
const STARTED_AT = 4000;

describe("resolveAcpElapsedMs", () => {
	test("ticks while the turn is live and unfinished", () => {
		expect(
			resolveAcpElapsedMs({
				done: false,
				frozenMs: null,
				isLive: true,
				now: NOW,
				startedAt: STARTED_AT,
			})
		).toBe(6000);
	});

	test("prefers Core's finalized duration once done", () => {
		expect(
			resolveAcpElapsedMs({
				done: true,
				durationMs: 1234,
				frozenMs: 9999,
				isLive: true,
				now: NOW,
				startedAt: STARTED_AT,
			})
		).toBe(1234);
	});

	test("freezes at the last live value when the turn is interrupted", () => {
		// Stop / error / Core restart: no done:true frame ever arrives, and the
		// chat goes back to ready. The meter must stop at what the user last saw.
		expect(
			resolveAcpElapsedMs({
				done: false,
				frozenMs: 5000,
				isLive: false,
				now: NOW,
				startedAt: STARTED_AT,
			})
		).toBe(5000);
	});

	test("shows nothing for an interrupted turn reopened later", () => {
		// Fresh mount after a reload: `startedAt` is "now", so counting from it
		// would restart the timer from 0 on a turn that died days ago.
		expect(
			resolveAcpElapsedMs({
				done: false,
				frozenMs: null,
				isLive: false,
				now: NOW,
				startedAt: NOW,
			})
		).toBeNull();
	});

	test("still reports a finalized duration on an old turn", () => {
		expect(
			resolveAcpElapsedMs({
				done: true,
				durationMs: 42_000,
				frozenMs: null,
				isLive: false,
				now: NOW,
				startedAt: NOW,
			})
		).toBe(42_000);
	});

	test("reports nothing before the first frame is timed", () => {
		expect(
			resolveAcpElapsedMs({
				done: false,
				frozenMs: null,
				isLive: true,
				now: NOW,
				startedAt: null,
			})
		).toBeNull();
	});

	test("never reports a negative elapsed time", () => {
		expect(
			resolveAcpElapsedMs({
				done: false,
				frozenMs: null,
				isLive: true,
				now: NOW,
				startedAt: NOW + 500,
			})
		).toBe(0);
	});
});
