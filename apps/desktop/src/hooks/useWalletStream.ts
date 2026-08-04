// apps/desktop/src/hooks/useWalletStream.ts
//
// Live platform-credits balance for the caller's active org, streamed from the
// control-plane server (`/api/credits/wallet/stream`) via the shared SSE reader
// (lib/api/credits.ts → @ryuhq/protocol/sse). Any balance UI can mount this to
// reflect top-ups/debits the moment they land, without polling.
//
// Like useChannelStatus, this targets :3000 (session-authed) rather than the
// active Core node, so it lives outside the node-scoped query cache. It keeps a
// single reconnecting socket alive for the component's lifetime: the server
// re-sends the current balance as a snapshot frame on every (re)connect, so a
// heartbeat missed while disconnected self-heals.

import { useEffect, useState } from "react";
import {
	hasCreditsAuth,
	isTerminalCreditsError,
	openWalletStream,
	type WalletUpdate,
} from "@/src/lib/api/credits.ts";

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;
/**
 * Retry cadence for a failure that only USER action elsewhere can clear (no
 * active org, signed out). Still retried rather than abandoned, but at a cadence
 * that does not repeat the same 409 every few seconds for the life of the
 * session. Recovery does not depend on this timer being short: `useCreditsWallet`
 * refetches the wallet on window focus, so the BALANCE is already current when
 * the user comes back from creating an org — this only decides how long the live
 * stream stays down afterwards.
 */
const TERMINAL_RETRY_MS = 300_000;

/** Pause that resolves early when the stream is torn down. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true }
		);
	});
}

/** Run (and keep reconnecting) the wallet stream until `signal` aborts. */
async function runWalletStream(
	signal: AbortSignal,
	onWallet: (wallet: WalletUpdate) => void
): Promise<void> {
	let backoff = INITIAL_BACKOFF_MS;
	while (!signal.aborted) {
		// Set when the last attempt failed for a reason reconnecting cannot fix.
		let terminal = false;
		if (hasCreditsAuth()) {
			try {
				for await (const message of openWalletStream(signal)) {
					onWallet(message.data);
					backoff = INITIAL_BACKOFF_MS; // a live frame resets the backoff
				}
			} catch (e) {
				// Connect/read failed. A 409 (no active org) or 401 will keep failing
				// identically until the user acts, so it drops to the slow cadence
				// instead of riding the transient backoff up to 10s and staying there.
				terminal = isTerminalCreditsError(e);
			}
		}
		if (signal.aborted) {
			break;
		}
		if (terminal) {
			await delay(TERMINAL_RETRY_MS, signal);
			backoff = INITIAL_BACKOFF_MS;
			continue;
		}
		// When signed out we have no token; wait a full interval before retrying so
		// a later sign-in is picked up without hot-looping.
		await delay(hasCreditsAuth() ? backoff : MAX_BACKOFF_MS, signal);
		backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
	}
}

/**
 * Subscribe to the active org's live wallet balance. Returns the latest
 * {@link WalletUpdate} (null until the first snapshot frame arrives), updating in
 * place as top-ups/debits land.
 */
export function useWalletStream(): WalletUpdate | null {
	const [wallet, setWallet] = useState<WalletUpdate | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		runWalletStream(controller.signal, setWallet).catch(() => {
			// runWalletStream swallows its own errors and never rejects.
		});
		return () => controller.abort();
	}, []);

	return wallet;
}
