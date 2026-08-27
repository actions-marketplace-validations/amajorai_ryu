import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";

/** The order used after a password has been accepted. */
export type LoginFactor = "passkey" | "two-factor" | "email" | "none";

export type LoginFallbackFactor = "two-factor" | "email";

export interface LoginFactorDecisionInput {
	fallback?: LoginFallbackFactor;
	hasPasskey: boolean;
	trustedDevice: boolean;
	twoFactorEnabled: boolean;
}

export interface LoginFactorDecision {
	factor: LoginFactor;
	fallbackFactor: LoginFallbackFactor;
}

/**
 * Decide the factor without touching a request or database. Keeping this pure
 * makes the precedence explicit and protects it from UI-only regressions.
 */
export function decideLoginFactor(
	input: LoginFactorDecisionInput
): LoginFactorDecision {
	const fallbackFactor: LoginFallbackFactor = input.twoFactorEnabled
		? "two-factor"
		: "email";

	if (input.trustedDevice) {
		return { factor: "none", fallbackFactor };
	}

	if (input.fallback === "two-factor" && input.twoFactorEnabled) {
		return { factor: "two-factor", fallbackFactor };
	}

	if (input.fallback === "email" && !input.twoFactorEnabled) {
		return { factor: "email", fallbackFactor };
	}

	if (input.hasPasskey) {
		return { factor: "passkey", fallbackFactor };
	}

	if (input.twoFactorEnabled) {
		return { factor: "two-factor", fallbackFactor };
	}

	return { factor: "email", fallbackFactor };
}

export const LOGIN_PENDING_COOKIE = "ryu_login_pending";
export const LOGIN_TRUST_COOKIE = "ryu_login_trust";
export const LOGIN_TRUST_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const LOGIN_PENDING_MAX_AGE_SECONDS = 10 * 60;

interface LoginCookie {
	attributes: Record<string, unknown>;
	name: string;
}

interface AdapterWhere {
	field: string;
	value: unknown;
}

interface LoginAssuranceContext {
	body?: unknown;
	context: {
		adapter: {
			findMany<T = unknown>(input: {
				model: string;
				where?: AdapterWhere[];
			}): Promise<T[]>;
			findOne<T = unknown>(input: {
				model: string;
				where?: AdapterWhere[];
			}): Promise<T | null>;
		};
		createAuthCookie: (
			name: string,
			overrides?: { maxAge?: number }
		) => LoginCookie;
		internalAdapter: {
			deleteSession: (token: string) => Promise<unknown>;
		};
		newSession?: {
			session?: { token?: string };
			user?: {
				email?: string;
				id?: string;
				twoFactorEnabled?: boolean | null;
			};
		} | null;
		secret: string;
		setNewSession: (session: unknown) => void;
	};
	getSignedCookie: (name: string, secret: string) => Promise<string | null>;
	header?: (name: string) => string | null;
	headers?: Headers;
	json: (body: unknown, init?: ResponseInit) => unknown;
	path?: string;
	request?: Request;
	setCookie: (
		name: string,
		value: string,
		options: Record<string, unknown>
	) => void;
	setSignedCookie: (
		name: string,
		value: string,
		secret: string,
		options: Record<string, unknown>
	) => Promise<unknown>;
}

interface PendingLogin {
	email: string;
	expiresAt: number;
	rememberDevice: boolean;
	userId: string;
}

interface TrustedDevice {
	expiresAt: number;
	userId: string;
}

interface NewLoginSession {
	token: string;
	userEmail: string;
	userId: string;
}

function contextOf(value: unknown): LoginAssuranceContext {
	return value as LoginAssuranceContext;
}

function recordOf(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeEmail(value: string): string {
	return value.trim().toLowerCase();
}

function parsePendingLogin(value: string | null): PendingLogin | null {
	if (!value) {
		return null;
	}

	try {
		const parsed = recordOf(JSON.parse(value));
		const email = stringValue(parsed?.email);
		const expiresAt = parsed?.expiresAt;
		const userId = stringValue(parsed?.userId);
		if (
			!(email && userId) ||
			typeof expiresAt !== "number" ||
			!Number.isFinite(expiresAt) ||
			expiresAt <= Date.now()
		) {
			return null;
		}
		return {
			email: normalizeEmail(email),
			expiresAt,
			rememberDevice: parsed?.rememberDevice === true,
			userId,
		};
	} catch {
		return null;
	}
}

function parseTrustedDevice(value: string | null): TrustedDevice | null {
	if (!value) {
		return null;
	}

	try {
		const parsed = recordOf(JSON.parse(value));
		const expiresAt = parsed?.expiresAt;
		const userId = stringValue(parsed?.userId);
		if (
			!userId ||
			typeof expiresAt !== "number" ||
			!Number.isFinite(expiresAt) ||
			expiresAt <= Date.now()
		) {
			return null;
		}
		return { expiresAt, userId };
	} catch {
		return null;
	}
}

async function signedCookie(
	ctx: LoginAssuranceContext,
	name: string
): Promise<{ cookie: LoginCookie; value: string | null }> {
	const cookie = ctx.context.createAuthCookie(name);
	const value = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
	return { cookie, value };
}

async function pendingLogin(
	ctx: LoginAssuranceContext
): Promise<{ cookie: LoginCookie; pending: PendingLogin | null }> {
	const signed = await signedCookie(ctx, LOGIN_PENDING_COOKIE);
	return { cookie: signed.cookie, pending: parsePendingLogin(signed.value) };
}

async function trustedDevice(
	ctx: LoginAssuranceContext,
	userId: string
): Promise<boolean> {
	const signed = await signedCookie(ctx, LOGIN_TRUST_COOKIE);
	const trusted = parseTrustedDevice(signed.value);
	if (signed.value && !trusted) {
		clearCookie(ctx, signed.cookie);
	}
	return trusted?.userId === userId;
}

function clearCookie(ctx: LoginAssuranceContext, cookie: LoginCookie): void {
	ctx.setCookie(cookie.name, "", {
		...cookie.attributes,
		maxAge: 0,
	});
}

async function setPendingLogin(
	ctx: LoginAssuranceContext,
	input: { email: string; rememberDevice: boolean; userId: string }
): Promise<void> {
	const cookie = ctx.context.createAuthCookie(LOGIN_PENDING_COOKIE, {
		maxAge: LOGIN_PENDING_MAX_AGE_SECONDS,
	});
	await ctx.setSignedCookie(
		cookie.name,
		JSON.stringify({
			email: normalizeEmail(input.email),
			expiresAt: Date.now() + LOGIN_PENDING_MAX_AGE_SECONDS * 1000,
			rememberDevice: input.rememberDevice,
			userId: input.userId,
		}),
		ctx.context.secret,
		cookie.attributes
	);
}

async function setTrustedDevice(
	ctx: LoginAssuranceContext,
	userId: string
): Promise<void> {
	const cookie = ctx.context.createAuthCookie(LOGIN_TRUST_COOKIE, {
		maxAge: LOGIN_TRUST_MAX_AGE_SECONDS,
	});
	const expiresAt = Date.now() + LOGIN_TRUST_MAX_AGE_SECONDS * 1000;
	await ctx.setSignedCookie(
		cookie.name,
		JSON.stringify({ expiresAt, userId }),
		ctx.context.secret,
		cookie.attributes
	);
}

function newLoginSession(ctx: LoginAssuranceContext): NewLoginSession | null {
	const session = ctx.context.newSession;
	const token = stringValue(session?.session?.token);
	const userId = stringValue(session?.user?.id);
	const userEmail = stringValue(session?.user?.email);
	if (!(token && userId && userEmail)) {
		return null;
	}
	return { token, userEmail: normalizeEmail(userEmail), userId };
}

async function removeNewSession(
	ctx: LoginAssuranceContext,
	session: NewLoginSession
): Promise<void> {
	deleteSessionCookie(
		ctx as unknown as Parameters<typeof deleteSessionCookie>[0],
		true
	);
	await ctx.context.internalAdapter.deleteSession(session.token);
	ctx.context.setNewSession(null);
}

function requestHeader(
	ctx: LoginAssuranceContext,
	name: string
): string | null {
	return (
		ctx.request?.headers.get(name) ??
		ctx.headers?.get(name) ??
		ctx.header?.(name) ??
		null
	);
}

function pendingMatchesSession(
	pending: PendingLogin | null,
	session: NewLoginSession
): boolean {
	return (
		pending?.userId === session.userId && pending.email === session.userEmail
	);
}

/**
 * Runs in the config-level after hook, before Better Auth's 2FA plugin hook.
 * That ordering lets passkey and email challenges replace the password session
 * while still allowing the built-in 2FA plugin to own its fallback challenge.
 */
export async function loginAssuranceAfterPassword(
	value: unknown
): Promise<unknown | undefined> {
	const ctx = contextOf(value);
	if (ctx.path !== "/sign-in/email") {
		return;
	}

	const session = newLoginSession(ctx);
	if (!session) {
		return;
	}

	const body = recordOf(ctx.body);
	const fallback =
		body?.factorFallback === "two-factor" || body?.factorFallback === "email"
			? body.factorFallback
			: undefined;
	const rememberDevice = body?.rememberDevice === true;
	const twoFactorEnabled = Boolean(
		ctx.context.newSession?.user?.twoFactorEnabled
	);

	if (await trustedDevice(ctx, session.userId)) {
		if (rememberDevice) {
			await setTrustedDevice(ctx, session.userId);
		}
		return;
	}

	const pending = await pendingLogin(ctx);
	const pendingMatches = pendingMatchesSession(pending.pending, session);
	if (pendingMatches && fallback === "two-factor" && twoFactorEnabled) {
		await setPendingLogin(ctx, {
			email: session.userEmail,
			rememberDevice,
			userId: session.userId,
		});
		return;
	}

	const passkeys = await ctx.context.adapter.findMany({
		model: "passkey",
		where: [{ field: "userId", value: session.userId }],
	});
	const decision = decideLoginFactor({
		fallback: pendingMatches ? fallback : undefined,
		hasPasskey: passkeys.length > 0,
		trustedDevice: false,
		twoFactorEnabled,
	});

	if (decision.factor === "none") {
		return;
	}

	await setPendingLogin(ctx, {
		email: session.userEmail,
		rememberDevice,
		userId: session.userId,
	});

	if (decision.factor === "two-factor") {
		// Leave the password-created session for Better Auth's 2FA after hook,
		// which replaces it with its own signed challenge cookie.
		return;
	}

	await removeNewSession(ctx, session);
	return ctx.json({
		fallbackFactor: decision.fallbackFactor,
		loginFactor: decision.factor,
	});
}

/**
 * Prevent an email OTP from a different account being used to finish a
 * pending password login. Direct email-OTP sign-in without a pending cookie is
 * still supported by Better Auth's normal passwordless flow.
 */
export async function assertPendingEmailMatches(value: unknown): Promise<void> {
	const ctx = contextOf(value);
	if (ctx.path !== "/sign-in/email-otp") {
		return;
	}

	const { pending } = await pendingLogin(ctx);
	if (!pending) {
		return;
	}

	const email = stringValue(recordOf(ctx.body)?.email);
	if (!email || normalizeEmail(email) !== pending.email) {
		throw new APIError("UNAUTHORIZED", {
			message: "This sign-in challenge belongs to a different account",
		});
	}
}

/**
 * Better Auth's passkey endpoint normally accepts any discoverable passkey.
 * During the password-login flow, bind the assertion to the account whose
 * password was just accepted before the plugin creates a real session.
 */
export async function assertPendingPasskeyMatches(
	value: unknown
): Promise<void> {
	const ctx = contextOf(value);
	const { pending } = await pendingLogin(ctx);
	if (!pending) {
		return;
	}

	const response = recordOf(recordOf(ctx.body)?.response);
	const credentialId = stringValue(response?.id);
	if (!credentialId) {
		throw new APIError("UNAUTHORIZED", {
			message: "Invalid passkey sign-in challenge",
		});
	}

	const passkey = await ctx.context.adapter.findOne<{ userId?: unknown }>({
		model: "passkey",
		where: [{ field: "credentialID", value: credentialId }],
	});
	if (!passkey || String(passkey.userId) !== pending.userId) {
		throw new APIError("UNAUTHORIZED", {
			message: "That passkey is not registered to this account",
		});
	}
}

/**
 * Finalize the unified trust cookie after a passkey, 2FA, or email fallback
 * succeeds. The trust choice is never accepted until the factor endpoint has
 * completed successfully.
 */
export async function loginAssuranceAfterFactor(value: unknown): Promise<void> {
	const ctx = contextOf(value);
	if (
		ctx.path !== "/passkey/verify-authentication" &&
		ctx.path !== "/sign-in/email-otp" &&
		ctx.path !== "/two-factor/verify-totp" &&
		ctx.path !== "/two-factor/verify-otp" &&
		ctx.path !== "/two-factor/verify-backup-code"
	) {
		return;
	}

	const session = newLoginSession(ctx);
	if (!session) {
		return;
	}

	const pending = await pendingLogin(ctx);
	if (pendingMatchesSession(pending.pending, session)) {
		const body = recordOf(ctx.body);
		if (pending.pending?.rememberDevice || body?.trustDevice === true) {
			await setTrustedDevice(ctx, session.userId);
		}
		clearCookie(ctx, pending.cookie);
		return;
	}

	if (
		ctx.path === "/passkey/verify-authentication" &&
		requestHeader(ctx, "x-ryu-remember-device") === "true"
	) {
		await setTrustedDevice(ctx, session.userId);
	}
}

/** Remove an abandoned pending cookie when Better Auth's 2FA trust cookie lets the password login through. */
async function cleanupPendingAfterPasswordSignIn(
	value: unknown
): Promise<void> {
	const ctx = contextOf(value);
	if (ctx.path !== "/sign-in/email") {
		return;
	}
	const session = newLoginSession(ctx);
	if (!session) {
		return;
	}
	const pending = await pendingLogin(ctx);
	if (pendingMatchesSession(pending.pending, session)) {
		clearCookie(ctx, pending.cookie);
	}
}

/**
 * This hook must run after the built-in two-factor hook. It only cleans up the
 * pending cookie when that hook chose its trusted-device fast path and kept the
 * session alive; a real 2FA challenge leaves the pending cookie in place until
 * its verification endpoint calls loginAssuranceAfterFactor.
 */
export function loginAssuranceCleanupPlugin(): BetterAuthPlugin {
	return {
		id: "ryu-login-assurance-cleanup",
		hooks: {
			after: [
				{
					matcher: (ctx: { path?: string }) => ctx.path === "/sign-in/email",
					handler: createAuthMiddleware(async (ctx) => {
						await cleanupPendingAfterPasswordSignIn(ctx);
					}),
				},
			],
		},
	};
}
