// Client half of Core's device-code pairing flow (`apps/core/src/pairing/mod.rs`).
//
// Core authenticates its local API by default. A surface that runs as its own
// process just reads the minted token off disk (`./node-token.ts`), but a BROWSER
// page cannot read a local file — and neither can a desktop running on a
// different machine from the node. Those clients pair instead: ask the node for a
// code, have a human approve it somewhere already trusted, then poll for a bearer
// of their own.
//
// BROWSER-SAFE. Deliberately free of `node:*` imports so the webapp and the
// extension can both use it; `./node-token.ts` is the Node-only counterpart.

/** What `POST /api/pair/code` returns. */
export interface PairingStart {
	/** The client's polling secret. Never show this to the user. */
	device_code: string;
	/** Seconds the request stays claimable. */
	expires_in: number;
	/** Seconds to wait between polls. */
	interval: number;
	/** The short code to DISPLAY, so the approver can confirm it matches. */
	user_code: string;
}

/** Terminal + non-terminal outcomes of a poll, mirroring the OAuth device grant. */
export type PairingPoll =
	| { status: "approved"; token: string }
	| { status: "pending" }
	| { status: "denied" }
	| { status: "expired" };

const JSON_HEADERS = { "content-type": "application/json" };

/** Strip a trailing slash so `${base}${path}` never doubles up. */
function normalizeBase(coreUrl: string): string {
	return coreUrl.replace(/\/$/, "");
}

/**
 * Begin pairing with the Core at `coreUrl`.
 *
 * `clientName` is shown to whoever approves it and is otherwise untrusted — Core
 * caps its length and never makes an access decision from it.
 */
export async function startPairing(
	coreUrl: string,
	clientName: string,
	signal?: AbortSignal
): Promise<PairingStart> {
	const resp = await fetch(`${normalizeBase(coreUrl)}/api/pair/code`, {
		method: "POST",
		headers: JSON_HEADERS,
		body: JSON.stringify({ client_name: clientName }),
		signal,
	});
	if (!resp.ok) {
		throw new Error(
			`Could not start pairing with ${coreUrl} (HTTP ${resp.status}). Is Ryu running?`
		);
	}
	return (await resp.json()) as PairingStart;
}

/**
 * Poll once for the outcome.
 *
 * Core answers 200 even for `authorization_pending` (as the device grant does),
 * so a pending poll stays out of the caller's error path. A transport failure
 * still throws.
 */
export async function pollPairing(
	coreUrl: string,
	deviceCode: string,
	signal?: AbortSignal
): Promise<PairingPoll> {
	const resp = await fetch(`${normalizeBase(coreUrl)}/api/pair/token`, {
		method: "POST",
		headers: JSON_HEADERS,
		body: JSON.stringify({ device_code: deviceCode }),
		signal,
	});
	if (!resp.ok) {
		throw new Error(`Pairing poll failed (HTTP ${resp.status})`);
	}
	const body = (await resp.json()) as { error?: string; token?: string };
	if (body.token) {
		return { status: "approved", token: body.token };
	}
	switch (body.error) {
		case "access_denied":
			return { status: "denied" };
		case "expired_token":
			return { status: "expired" };
		default:
			return { status: "pending" };
	}
}

/**
 * Run a full pairing: start, surface the user code, poll until it resolves.
 *
 * `onCode` fires once with the code to display. Resolves with the bearer on
 * approval, or `null` when the user denied it or let it expire — both are
 * ordinary outcomes the caller should render, not exceptions.
 *
 * Honours the server's `interval` rather than a hardcoded delay, so raising it
 * server-side actually slows clients down.
 */
export async function runPairing(
	coreUrl: string,
	clientName: string,
	onCode: (userCode: string, expiresIn: number) => void,
	signal?: AbortSignal
): Promise<string | null> {
	if (signal?.aborted) {
		return null;
	}
	const started = await startPairing(coreUrl, clientName, signal);
	onCode(started.user_code, started.expires_in);

	const intervalMs = Math.max(1, started.interval) * 1000;
	const deadline = Date.now() + started.expires_in * 1000;

	// Poll FIRST, sleep after. Sleeping first makes a user who approves
	// instantly still wait out a full interval, which reads as the flow having
	// hung at the exact moment it succeeded.
	while (Date.now() < deadline) {
		if (signal?.aborted) {
			return null;
		}
		const result = await pollPairing(coreUrl, started.device_code, signal);
		if (result.status === "approved") {
			return result.token;
		}
		if (result.status === "denied" || result.status === "expired") {
			return null;
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	return null;
}
