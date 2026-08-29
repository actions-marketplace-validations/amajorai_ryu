// User authentication for the Ryu MCP server via the OAuth 2.0 Device
// Authorization Grant (RFC 8628). This is the same Better Auth flow the
// desktop, mobile, and CLI clients use, but it runs directly against the
// control plane so `ryu-mcp login` does not require a local Core node.
//
// The stored credential is a Better Auth control-plane session token. It
// identifies the user to the control plane for `whoami` and account operations.
// It is NOT a Core node-admittance bearer. Core requests use the separate
// `RYU_CORE_TOKEN` or a local node token.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_AUTH_BACKEND = "http://localhost:3000";
const DEVICE_CLIENT_ID = "ryu-mcp";
const OAUTH_SCOPES = "openid profile email";
const DEFAULT_INTERVAL_SECONDS = 5;
const DEFAULT_EXPIRES_SECONDS = 900;
const MAX_INTERVAL_SECONDS = 60;
const MAX_EXPIRES_SECONDS = 3600;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SECRET_DIR_MODE = 0o700;
const SECRET_FILE_MODE = 0o600;

/** Persisted control-plane session for this MCP bridge only. */
export interface AuthData {
	backendUrl?: string;
	email?: string | null;
	name?: string | null;
	token: string;
}

export interface DeviceAuthStart {
	backendUrl: string;
	deviceCode: string;
	expiresIn: number;
	interval: number;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string;
}

const ryuDir = (): string =>
	process.env.RYU_HOME?.trim() || join(homedir(), ".ryu");
const authFilePath = (): string =>
	process.env.RYU_MCP_AUTH_FILE?.trim() || join(ryuDir(), "mcp-auth.json");

/** Control-plane (Better Auth) base URL. */
/** Allow plaintext only for a local control plane; remote auth must use HTTPS. */
export const safeAuthBackendUrl = (value: string): string => {
	const parsed = new URL(value);
	const isLoopback =
		parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
	if (parsed.protocol !== "https:" && !isLoopback) {
		throw new Error("RYU_AUTH_URL must use HTTPS unless it targets loopback");
	}
	return parsed.href.replace(/\/$/, "");
};

export const authBackendUrl = (): string =>
	safeAuthBackendUrl(process.env.RYU_AUTH_URL?.trim() || DEFAULT_AUTH_BACKEND);

const boundedPositiveSeconds = (
	value: unknown,
	fallback: number,
	maximum: number
): number => {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return Math.min(value, maximum);
};

/** Read this bridge's local credential, or null when absent/malformed. */
export const loadToken = (): AuthData | null => {
	try {
		const data = JSON.parse(readFileSync(authFilePath(), "utf8")) as AuthData;
		return typeof data.token === "string" && data.token ? data : null;
	} catch {
		return null;
	}
};

/** Write the credential 0600 under ~/.ryu (0700). Mode is ignored on Windows. */
const saveToken = (data: AuthData): void => {
	mkdirSync(dirname(authFilePath()), {
		recursive: true,
		mode: SECRET_DIR_MODE,
	});
	writeFileSync(authFilePath(), JSON.stringify(data, null, 2), {
		mode: SECRET_FILE_MODE,
	});
};

export const clearToken = (): void => {
	try {
		rmSync(authFilePath());
	} catch {
		// Already absent - nothing to clear.
	}
};

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

class TerminalDeviceAuthError extends Error {}

/** Return a canonical URL that is safe to hand to an OS browser launcher. */
export const safeBrowserUrl = (value: string): string | null => {
	try {
		const parsed = new URL(value);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return null;
		}
		return parsed.href;
	} catch {
		return null;
	}
};

/** Open a URL in the default browser, cross-platform. Best-effort. */
const openBrowser = (url: string): void => {
	const safeUrl = safeBrowserUrl(url);
	if (!safeUrl) {
		return;
	}
	try {
		if (process.platform === "win32") {
			spawn("rundll32.exe", ["url.dll,FileProtocolHandler", safeUrl], {
				stdio: "ignore",
				detached: true,
			}).unref();
			return;
		}
		const command = process.platform === "darwin" ? "open" : "xdg-open";
		spawn(command, [safeUrl], { stdio: "ignore", detached: true }).unref();
	} catch {
		// Non-fatal: the URL is also printed for manual navigation.
	}
};

/** Start the Better Auth device grant directly at the control plane. */
export const requestDeviceCode = async (
	backendUrl: string
): Promise<DeviceAuthStart> => {
	const base = safeAuthBackendUrl(backendUrl);
	const resp = await fetch(`${base}/api/auth/device/code`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			client_id: DEVICE_CLIENT_ID,
			scope: OAUTH_SCOPES,
		}),
	});
	const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
	if (!resp.ok) {
		throw new Error(
			`Device code request failed (${resp.status}): ${String(data.error ?? "unknown error")}`
		);
	}
	const deviceCode =
		typeof data.device_code === "string" ? data.device_code : "";
	const userCode = typeof data.user_code === "string" ? data.user_code : "";
	if (!(deviceCode && userCode)) {
		throw new Error("Better Auth returned an invalid device code response");
	}
	const configuredVerificationUri =
		typeof data.verification_uri === "string"
			? safeBrowserUrl(data.verification_uri)
			: null;
	const verificationUri = configuredVerificationUri ?? `${base}/device`;
	const verificationUriComplete =
		typeof data.verification_uri_complete === "string"
			? safeBrowserUrl(data.verification_uri_complete)
			: null;
	return {
		backendUrl: base,
		deviceCode,
		expiresIn: boundedPositiveSeconds(
			data.expires_in,
			DEFAULT_EXPIRES_SECONDS,
			MAX_EXPIRES_SECONDS
		),
		interval: boundedPositiveSeconds(
			data.interval,
			DEFAULT_INTERVAL_SECONDS,
			MAX_INTERVAL_SECONDS
		),
		userCode,
		verificationUri,
		verificationUriComplete: verificationUriComplete ?? verificationUri,
	};
};

/** Poll Better Auth until the device grant is approved, denied, or expires. */
export const pollDeviceToken = async (
	backendUrl: string,
	deviceCode: string,
	intervalSeconds: number,
	expiresInSeconds: number
): Promise<string> => {
	const base = safeAuthBackendUrl(backendUrl);
	const expiresIn = boundedPositiveSeconds(
		expiresInSeconds,
		DEFAULT_EXPIRES_SECONDS,
		MAX_EXPIRES_SECONDS
	);
	const deadline = Date.now() + expiresIn * 1000;
	let interval =
		boundedPositiveSeconds(
			intervalSeconds,
			DEFAULT_INTERVAL_SECONDS,
			MAX_INTERVAL_SECONDS
		) * 1000;
	while (Date.now() < deadline) {
		let shouldContinue = false;
		try {
			const resp = await fetch(`${base}/api/auth/device/token`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					client_id: DEVICE_CLIENT_ID,
					device_code: deviceCode,
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				}),
			});
			const data = (await resp.json().catch(() => ({}))) as Record<
				string,
				unknown
			>;
			const token = data.access_token;
			if (typeof token === "string" && token) {
				return token;
			}
			switch (data.error) {
				case "access_denied":
					throw new TerminalDeviceAuthError(
						"Access denied. You declined the sign-in request."
					);
				case "expired_token":
					throw new TerminalDeviceAuthError(
						"The sign-in request expired. Please try again."
					);
				case "slow_down":
					interval = Math.min(interval + 5000, MAX_INTERVAL_SECONDS * 1000);
					shouldContinue = true;
					break;
				case undefined:
				case "authorization_pending":
					shouldContinue = true;
					break;
				default:
					throw new TerminalDeviceAuthError(
						`Sign-in failed: ${String(data.error)}`
					);
			}
		} catch (error) {
			if (error instanceof TerminalDeviceAuthError) {
				throw error;
			}
			// A transport failure is transient. Keep polling until the grant expires.
			shouldContinue = true;
		}
		if (shouldContinue) {
			await sleep(interval);
		}
	}
	throw new Error("Login timed out. Please try again.");
};

/** Run the device authorization flow and persist this bridge's session. */
export const runLogin = async (): Promise<void> => {
	const backend = authBackendUrl();
	let start: DeviceAuthStart;
	try {
		start = await requestDeviceCode(backend);
	} catch (error) {
		throw new Error(
			`Could not reach the Ryu control plane at ${backend}: ${String(error)}`
		);
	}

	process.stdout.write("Opening your browser to sign in to Ryu...\n");
	process.stdout.write(
		`If it does not open, visit:\n  ${start.verificationUriComplete}\n`
	);
	process.stdout.write(`Device code: ${start.userCode}\n`);
	openBrowser(start.verificationUriComplete);
	process.stdout.write(
		"Waiting for you to approve the sign-in (Ctrl+C to cancel)...\n"
	);

	const token = await pollDeviceToken(
		start.backendUrl,
		start.deviceCode,
		start.interval,
		start.expiresIn
	);
	const user = await fetchSession(token, start.backendUrl);
	saveToken({
		backendUrl: start.backendUrl,
		token,
		email: (user?.email as string | undefined) ?? null,
		name: (user?.name as string | undefined) ?? null,
	});

	process.stdout.write("Signed in.\n");
	if (user?.name) {
		process.stdout.write(`  Name:  ${String(user.name)}\n`);
	}
	if (user?.email) {
		process.stdout.write(`  Email: ${String(user.email)}\n`);
	}
};

/** Clear this bridge's local session without changing other Ryu clients. */
export const runLogout = (): void => {
	clearToken();
	process.stdout.write("Signed out.\n");
};

/** Fetch the control-plane user for the stored session. */
export const fetchSession = async (
	token: string,
	backendUrl?: string
): Promise<Record<string, unknown> | null> => {
	try {
		const resp = await fetch(
			`${safeAuthBackendUrl(backendUrl ?? authBackendUrl())}/api/auth/get-session`,
			{
				headers: { Authorization: `Bearer ${token}` },
			}
		);
		if (!resp.ok) {
			return null;
		}
		const json = (await resp.json()) as { user?: Record<string, unknown> };
		return json.user ?? null;
	} catch {
		return null;
	}
};

/** Print the signed-in user, or an actionable login hint. */
export const runWhoami = async (): Promise<void> => {
	const data = loadToken();
	if (!data) {
		process.stdout.write("Not signed in. Run `ryu-mcp login`.\n");
		return;
	}
	const user = await fetchSession(data.token, data.backendUrl);
	if (user) {
		process.stdout.write(
			`Signed in as ${String(user.name ?? "?")} <${String(user.email ?? "?")}>\n`
		);
		return;
	}
	const who = data.name || data.email || "stored credential";
	process.stdout.write(
		`Signed in (${who}) - control plane unreachable or token expired.\n`
	);
};
