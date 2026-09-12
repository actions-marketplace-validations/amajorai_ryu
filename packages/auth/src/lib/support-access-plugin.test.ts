import { afterAll, describe, expect, it, mock } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { admin, bearer } from "better-auth/plugins";
import { jwt } from "better-auth/plugins/jwt";

interface GrantRow {
	_id: string;
	expiresAt: Date;
	scopes: string[];
	status: string;
	userId: string;
}

interface AuditRow {
	_id: string;
	actorEmail: string;
	actorId: string;
	endedAt?: Date | null;
	endedReason?: string;
	grantId: string;
	reason: string;
	scopes: string[];
	sessionId: string;
	startedAt: Date;
	userId: string;
}

const grants: GrantRow[] = [];
const audits: AuditRow[] = [];
const stepUpGrants: Array<{
	expiresAt: Date;
	scope: string;
	sessionId: string;
}> = [];

function queryResult<T>(value: T) {
	const result = {
		lean: async <R>() => value as R,
		select: () => result,
		sort: () => result,
	};
	return result;
}

mock.module("@ryu/db/models/support-access.model", () => ({
	SUPPORT_ACCESS_MAX_DURATION_MS: 60 * 60 * 1000,
	SUPPORT_ACCESS_SCOPES: [
		"billing",
		"subscription",
		"organization",
		"sync-status",
		"channels",
		"marketplace",
	],
	SupportAccessAudit: {
		create: async (row: AuditRow) => {
			audits.push(row);
			return row;
		},
		findOne: (query: Partial<AuditRow>) =>
			queryResult(
				audits.find(
					(row) =>
						(!query.actorId || row.actorId === query.actorId) &&
						(!query.grantId || row.grantId === query.grantId) &&
						(!query.sessionId || row.sessionId === query.sessionId) &&
						(!query.userId || row.userId === query.userId) &&
						(query.endedAt === undefined || row.endedAt == null)
				) ?? null
			),
		updateMany: async (
			query: { actorId?: string; endedAt?: null; sessionId?: string },
			update: { $set: { endedAt: Date; endedReason: string } }
		) => {
			for (const row of audits) {
				if (
					(query.actorId === undefined || row.actorId === query.actorId) &&
					(query.sessionId === undefined ||
						row.sessionId === query.sessionId) &&
					(query.endedAt === undefined || row.endedAt == null)
				) {
					row.endedAt = update.$set.endedAt;
					row.endedReason = update.$set.endedReason;
				}
			}
			return { modifiedCount: 1 };
		},
	},
	SupportAccessGrant: {
		findOne: (query: { status?: string; userId?: string; _id?: string }) =>
			queryResult(
				grants.find(
					(row) =>
						(query.status === undefined || row.status === query.status) &&
						(query.userId === undefined || row.userId === query.userId) &&
						(query._id === undefined || row._id === query._id)
				) ?? null
			),
	},
}));

mock.module("@ryu/db/models/step-up.model", () => ({
	StepUpAttempt: {},
	StepUpChallenge: {},
	StepUpGrant: {
		findOne: (query: {
			expiresAt: { $gt: Date };
			scope: string;
			sessionId: string;
		}) =>
			queryResult(
				stepUpGrants.find(
					(row) =>
						row.scope === query.scope &&
						row.sessionId === query.sessionId &&
						row.expiresAt > query.expiresAt.$gt
				) ?? null
			),
	},
}));

mock.module("@ryu/email", () => ({
	StepUpOTPEmail: () => null,
	sendEmail: async () => undefined,
}));

const { supportAccessPlugin } = await import("./support-access-plugin.ts");

const SECRET = "support-access-plugin-test-secret-at-least-32-characters";
const ACTOR_EMAIL = "support@example.com";
const ACTOR_PASSWORD = "a-strong-test-password";

function cookieJar(setCookies: string[]): string {
	const values = new Map<string, string>();
	for (const setCookie of setCookies) {
		const [pair, ...attributes] = setCookie.split(";");
		const separator = pair.indexOf("=");
		if (separator < 1) {
			continue;
		}
		const name = pair.slice(0, separator);
		const value = pair.slice(separator + 1);
		if (
			attributes.some(
				(attribute) => attribute.trim().toLowerCase() === "max-age=0"
			)
		) {
			values.delete(name);
		} else {
			values.set(name, value);
		}
	}
	return [...values.entries()]
		.map(([name, value]) => `${name}=${value}`)
		.join("; ");
}

async function fixture() {
	grants.length = 0;
	audits.length = 0;
	stepUpGrants.length = 0;
	process.env.ADMIN_EMAILS = ACTOR_EMAIL;
	const database = {
		account: [],
		jwks: [],
		session: [],
		twoFactor: [],
		user: [],
		verification: [],
	};
	const auth = betterAuth({
		baseURL: "http://localhost:3000",
		database: memoryAdapter(database),
		emailAndPassword: { enabled: true },
		secret: SECRET,
		plugins: [bearer(), admin(), jwt(), supportAccessPlugin()],
		user: {
			additionalFields: {
				twoFactorEnabled: { input: false, type: "boolean" },
			},
		},
	});

	const actorResult = await auth.api.createUser({
		body: {
			email: ACTOR_EMAIL,
			name: "Support Actor",
			password: ACTOR_PASSWORD,
			role: "admin",
		},
	});
	const actor = actorResult.user;
	const actorRecord = database.user.find((user) => user.id === actor.id);
	if (actorRecord) {
		actorRecord.twoFactorEnabled = true;
	}
	const targetResult = await auth.api.createUser({
		body: {
			email: "customer@example.com",
			name: "Customer",
			password: ACTOR_PASSWORD,
		},
	});
	const target = targetResult.user;
	const signIn = await auth.api.signInEmail({
		asResponse: true,
		body: { email: ACTOR_EMAIL, password: ACTOR_PASSWORD },
	});
	const actorCookie = cookieJar(signIn.headers.getSetCookie());
	const actorSession = await auth.api.getSession({
		headers: new Headers({ cookie: actorCookie }),
		query: { disableCookieCache: true },
	});
	if (!actorSession) {
		throw new Error("actor session was not created");
	}
	stepUpGrants.push({
		expiresAt: new Date(Date.now() + 60_000),
		scope: "platform.admin",
		sessionId: actorSession.session.id,
	});
	grants.push({
		_id: "grant-1",
		expiresAt: new Date(Date.now() + 5 * 60_000),
		scopes: ["billing", "channels"],
		status: "active",
		userId: target.id,
	});
	return { actor, actorCookie, actorSession, auth, target };
}

afterAll(() => {
	mock.restore();
	delete process.env.ADMIN_EMAILS;
});

describe("hosted support Better Auth integration", () => {
	it("closes native impersonation, keeps the issuer server-only, and hands off a bounded session", async () => {
		const f = await fixture();
		const rawNative = await f.auth.handler(
			new Request("http://localhost:3000/api/auth/admin/impersonate-user", {
				body: JSON.stringify({ userId: f.target.id }),
				headers: {
					"content-type": "application/json",
					cookie: f.actorCookie,
					origin: "http://localhost:3000",
				},
				method: "POST",
			})
		);
		expect(rawNative.status).toBe(403);
		const rawNativeBearer = await f.auth.handler(
			new Request("http://localhost:3000/api/auth/admin/impersonate-user", {
				body: JSON.stringify({ userId: f.target.id }),
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${f.actorSession.session.token}`,
					origin: "http://localhost:3000",
				},
				method: "POST",
			})
		);
		expect(rawNativeBearer.status).toBe(403);

		const rawSupport = await f.auth.handler(
			new Request("http://localhost:3000/api/auth/support/impersonate-user", {
				body: JSON.stringify({
					reason: "Investigate billing",
					scopes: ["billing"],
					userId: f.target.id,
				}),
				headers: {
					"content-type": "application/json",
					cookie: f.actorCookie,
					origin: "http://localhost:3000",
				},
				method: "POST",
			})
		);
		expect(rawSupport.status).toBe(404);

		const supportApi = f.auth.api as unknown as {
			startSupportSession: (input: {
				asResponse: true;
				body: { reason: string; scopes: string[]; userId: string };
				headers: Headers;
			}) => Promise<Response>;
		};
		const liveGrant = grants[0];
		grants.length = 0;
		const noGrant = await supportApi.startSupportSession({
			asResponse: true,
			body: {
				reason: "No consent",
				scopes: ["billing"],
				userId: f.target.id,
			},
			headers: new Headers({ cookie: f.actorCookie }),
		});
		expect(noGrant.status).toBe(403);
		if (liveGrant) {
			grants.push(liveGrant);
		}
		const emptyScopes = await supportApi.startSupportSession({
			asResponse: true,
			body: {
				reason: "Empty scope list",
				scopes: [],
				userId: f.target.id,
			},
			headers: new Headers({ cookie: f.actorCookie }),
		});
		expect(emptyScopes.status).toBe(400);
		const started = await supportApi.startSupportSession({
			asResponse: true,
			body: {
				reason: "Investigate billing",
				scopes: ["billing"],
				userId: f.target.id,
			},
			headers: new Headers({ cookie: f.actorCookie }),
		});
		expect(started.status).toBe(200);
		const startedBody = (await started.json()) as {
			auditId: string;
			expiresAt: string;
			scopes: string[];
			session: { expiresAt: string; id: string; token: string };
		};
		expect(startedBody.scopes).toEqual(["billing"]);
		expect(startedBody.session.token.length).toBeGreaterThan(20);
		expect(
			new Date(startedBody.session.expiresAt).getTime()
		).toBeLessThanOrEqual(grants[0]?.expiresAt.getTime() ?? 0);
		expect(audits).toHaveLength(1);
		expect(audits[0]?.sessionId).toBe(startedBody.session.id);
		expect(
			started.headers
				.getSetCookie()
				.some((value) => value.includes("admin_session"))
		).toBe(true);

		const targetSession = await f.auth.api.getSession({
			headers: new Headers({
				authorization: `Bearer ${startedBody.session.token}`,
			}),
			query: { disableCookieCache: true },
		});
		expect(targetSession?.user.id).toBe(f.target.id);
		expect(targetSession?.session.impersonatedBy).toBe(f.actor.id);

		const bearerStarted = await supportApi.startSupportSession({
			asResponse: true,
			body: {
				reason: "Investigate channels",
				scopes: ["channels"],
				userId: f.target.id,
			},
			headers: new Headers({
				authorization: `Bearer ${f.actorSession.session.token}`,
			}),
		});
		expect(bearerStarted.status).toBe(200);
		const bearerBody = (await bearerStarted.json()) as {
			scopes: string[];
			session: { token: string };
		};
		expect(bearerBody.scopes).toEqual(["channels"]);
		const bearerTargetSession = await f.auth.api.getSession({
			headers: new Headers({
				authorization: `Bearer ${bearerBody.session.token}`,
			}),
			query: { disableCookieCache: true },
		});
		expect(bearerTargetSession?.session.impersonatedBy).toBe(f.actor.id);
		const bearerStopStarted = await supportApi.startSupportSession({
			asResponse: true,
			body: {
				reason: "Stop bearer session",
				scopes: ["channels"],
				userId: f.target.id,
			},
			headers: new Headers({
				authorization: `Bearer ${f.actorSession.session.token}`,
			}),
		});
		const bearerStopBody = (await bearerStopStarted.json()) as {
			session: { id: string; token: string };
		};
		const bearerStop = await f.auth.handler(
			new Request("http://localhost:3000/api/auth/admin/stop-impersonating", {
				headers: {
					authorization: `Bearer ${bearerStopBody.session.token}`,
					origin: "http://localhost:3000",
				},
				method: "POST",
			})
		);
		expect(bearerStop.status).toBe(200);
		const bearerStopResult = (await bearerStop.json()) as {
			message: string;
			restored: boolean;
			requiresActorSession: boolean;
			success: boolean;
		};
		expect(bearerStopResult).toMatchObject({
			requiresActorSession: true,
			restored: false,
			success: true,
		});
		expect(bearerStopResult.message).toContain("retained support credential");
		expect(bearerStopResult).not.toHaveProperty("token");
		expect(bearerStop.headers.get("set-auth-token")).toBeNull();
		expect(
			await f.auth.api.getSession({
				headers: new Headers({
					authorization: `Bearer ${bearerStopBody.session.token}`,
				}),
				query: { disableCookieCache: true },
			})
		).toBeNull();
		expect(
			audits.some(
				(row) =>
					row.sessionId === bearerStopBody.session.id &&
					row.endedReason === "stopped"
			)
		).toBe(true);
		const actorAfterBearerStop = await f.auth.api.getSession({
			headers: new Headers({
				authorization: `Bearer ${f.actorSession.session.token}`,
			}),
		});
		expect(actorAfterBearerStop?.user.id).toBe(f.actor.id);
		const bearerSignOut = await f.auth.handler(
			new Request("http://localhost:3000/api/auth/sign-out", {
				headers: {
					authorization: `Bearer ${bearerBody.session.token}`,
					origin: "http://localhost:3000",
				},
				method: "POST",
			})
		);
		expect(bearerSignOut.status).toBe(200);
		expect(
			await f.auth.api.getSession({
				headers: new Headers({
					authorization: `Bearer ${bearerBody.session.token}`,
				}),
				query: { disableCookieCache: true },
			})
		).toBeNull();
	});

	it("removes the JWT handoff and restores the original native session after target deletion", async () => {
		const f = await fixture();
		const supportApi = f.auth.api as unknown as {
			startSupportSession: (input: {
				asResponse: true;
				body: { reason: string; scopes: string[]; userId: string };
				headers: Headers;
			}) => Promise<Response>;
		};
		const started = await supportApi.startSupportSession({
			asResponse: true,
			body: {
				reason: "Investigate channels",
				scopes: ["channels"],
				userId: f.target.id,
			},
			headers: new Headers({ cookie: f.actorCookie }),
		});
		const body = (await started.json()) as {
			session: { token: string };
		};
		const supportCookie = cookieJar(started.headers.getSetCookie());

		const getSession = await f.auth.handler(
			new Request("http://localhost:3000/api/auth/get-session", {
				headers: { cookie: supportCookie },
				method: "GET",
			})
		);
		expect(getSession.status).toBe(200);
		expect(getSession.headers.get("set-auth-jwt")).toBeNull();
		const rawJwtToken = await f.auth.handler(
			new Request("http://localhost:3000/api/auth/token", {
				headers: {
					authorization: `Bearer ${body.session.token}`,
					origin: "http://localhost:3000",
				},
				method: "GET",
			})
		);
		expect(rawJwtToken.status).toBe(403);
		const rawJwtCookie = await f.auth.handler(
			new Request("http://localhost:3000/api/auth/token", {
				headers: {
					cookie: supportCookie,
					origin: "http://localhost:3000",
				},
				method: "GET",
			})
		);
		expect(rawJwtCookie.status).toBe(403);

		await f.auth.api.revokeUserSession({
			body: { sessionToken: body.session.token },
			headers: new Headers({ cookie: f.actorCookie }),
		});
		const restored = await f.auth.handler(
			new Request("http://localhost:3000/api/auth/admin/stop-impersonating", {
				headers: {
					cookie: supportCookie,
					origin: "http://localhost:3000",
				},
				method: "POST",
			})
		);
		expect(restored.status).toBe(200);
		const restoredBody = (await restored.json()) as {
			user: { id: string };
		};
		expect(restoredBody.user.id).toBe(f.actor.id);
		expect(audits[0]?.endedReason).toBe("stopped");
	});
});
