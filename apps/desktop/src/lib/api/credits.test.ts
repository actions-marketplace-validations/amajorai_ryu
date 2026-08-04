// apps/desktop/src/lib/api/credits.test.ts
//
// The wallet is ORG-level, so a signed-in user with no organization gets a 409
// from `/api/credits/wallet/stream` — forever, until they create or select one.
// `useWalletStream` reconnects on failure, and before this mapping existed every
// one of those reconnects was an identical 409 in the console for the life of
// the session, on the transient 500ms→10s cadence.
//
// The fix is a classification, and it spans two packages: `openSse` throws an
// `SseConnectError` carrying the HTTP status (packages/protocol), and
// `openWalletStream` re-throws it as the `CreditsError` kind the loop reads. The
// unit under test here is that hand-off — `SseConnectError` → `CreditsError` →
// `isTerminalCreditsError` — because a break anywhere along it is SILENT: the
// loop simply falls through to the transient branch and the spam is unchanged.

import { describe, expect, test } from "bun:test";
import {
	CreditsError,
	isTerminalCreditsError,
	openWalletStream,
} from "./credits.ts";

const realFetch = globalThis.fetch;

/** Point `fetch` at a fixed status, as the control plane would answer. */
function mockFetchStatus(status: number): void {
	globalThis.fetch = (() =>
		Promise.resolve(
			new Response(null, { status })
		)) as unknown as typeof globalThis.fetch;
}

/** Drive the generator to its first `next()` and return whatever it threw. */
async function connectError(status: number): Promise<unknown> {
	mockFetchStatus(status);
	try {
		for await (const _message of openWalletStream(
			new AbortController().signal
		)) {
			// A mocked non-2xx never yields; reaching here is itself the failure.
			throw new Error("expected the connect to reject");
		}
		return null;
	} catch (e) {
		return e;
	} finally {
		globalThis.fetch = realFetch;
	}
}

describe("openWalletStream connect-failure classification", () => {
	test("maps a 409 to a terminal no_org CreditsError", async () => {
		const error = await connectError(409);
		expect(error).toBeInstanceOf(CreditsError);
		expect((error as CreditsError).kind).toBe("no_org");
		// The whole point: the reconnect loop must read this as "retrying cannot
		// help", not as a blip worth another attempt in half a second.
		expect(isTerminalCreditsError(error)).toBe(true);
	});

	test("maps a 401 to a terminal auth CreditsError", async () => {
		const error = await connectError(401);
		expect((error as CreditsError).kind).toBe("auth");
		expect(isTerminalCreditsError(error)).toBe(true);
	});

	// A restarting control plane must keep the fast cadence, or a deploy would
	// cost every client five minutes of stale balance.
	test("leaves a 500 transient", async () => {
		const error = await connectError(500);
		expect(error).toBeInstanceOf(CreditsError);
		expect((error as CreditsError).kind).toBe("unknown");
		expect(isTerminalCreditsError(error)).toBe(false);
	});

	test("does not treat a non-CreditsError as terminal", () => {
		expect(isTerminalCreditsError(new Error("network down"))).toBe(false);
		expect(isTerminalCreditsError(null)).toBe(false);
	});
});
