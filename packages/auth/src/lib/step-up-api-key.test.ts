import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { bearer, organization } from "better-auth/plugins";

const grants: Array<{ sessionId: string; scope: string; expiresAt: Date }> = [];
mock.module("@ryu/db/models/step-up.model", () => ({
	StepUpAttempt: {},
	StepUpChallenge: {},
	StepUpGrant: {
		findOne: (query: {
			sessionId: string;
			scope: string;
			expiresAt: { $gt: Date };
		}) => ({
			select: () => ({
				lean: async () =>
					grants.find(
						(grant) =>
							grant.sessionId === query.sessionId &&
							grant.scope === query.scope &&
							grant.expiresAt > query.expiresAt.$gt
					) ?? null,
			}),
		}),
	},
}));
mock.module("@ryu/email", () => ({
	StepUpOTPEmail: () => null,
	sendEmail: async () => undefined,
}));
const { stepUpGate } = await import("./step-up-plugin.ts");

afterAll(() => mock.restore());
beforeEach(() => {
	grants.length = 0;
});

async function fixture() {
	const database: Record<string, Record<string, unknown>[]> = {
		user: [],
		session: [],
		account: [],
		verification: [],
		organization: [],
		member: [],
		apikey: [],
	};
	const auth = betterAuth({
		baseURL: "http://localhost:3000",
		secret: "native-api-key-step-up-test-secret-at-least-32-characters",
		database: memoryAdapter(database),
		emailAndPassword: { enabled: true },
		plugins: [
			bearer(),
			organization(),
			apiKey([
				{ configId: "default", references: "user", enableMetadata: true },
				{
					configId: "organization",
					references: "organization",
					enableMetadata: true,
				},
			]),
			stepUpGate(),
		],
	});
	const signup = await auth.api.signUpEmail({
		body: {
			name: "Owner",
			email: "owner@example.com",
			password: "test-password-1234",
		},
		asResponse: true,
	});
	const body = (await signup.json()) as { user: { id: string }; token: string };
	const cookie = signup.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");
	const sessionId = String(database.session[0]?.id);
	database.organization.push({
		id: "org-1",
		name: "Workspace",
		slug: "workspace",
		createdAt: new Date(),
	});
	database.member.push({
		id: "member-1",
		userId: body.user.id,
		organizationId: "org-1",
		role: "owner",
		createdAt: new Date(),
	});
	const orgKey = await auth.api.createApiKey({
		body: {
			configId: "organization",
			userId: body.user.id,
			organizationId: "org-1",
			name: "Organization key",
		},
	});
	const personalKey = await auth.api.createApiKey({
		body: {
			configId: "default",
			userId: body.user.id,
			name: "Personal key",
			metadata: { ownerType: "org", organizationId: "org-1" },
		},
	});
	return {
		database,
		orgKey,
		personalKey,
		sessionId,
		request: (
			action: "delete" | "update",
			keyId: string,
			configId: string | undefined,
			transport: "cookie" | "bearer" = "bearer"
		) =>
			auth.handler(
				new Request(`http://localhost:3000/api/auth/api-key/${action}`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: "http://localhost:3000",
						...(transport === "bearer"
							? { authorization: `Bearer ${body.token}` }
							: { cookie }),
					},
					body: JSON.stringify({
						keyId,
						configId,
						...(action === "update" ? { enabled: false } : {}),
					}),
				})
			),
	};
}

describe("native organization API key step-up", () => {
	for (const action of ["delete", "update"] as const) {
		for (const transport of ["cookie", "bearer"] as const) {
			it(`rejects ${transport} ${action} without proof and permits it with current proof`, async () => {
				const f = await fixture();
				const rejected = await f.request(
					action,
					f.orgKey.id,
					"organization",
					transport
				);
				expect(rejected.status).toBe(403);
				expect(await rejected.json()).toMatchObject({
					code: "STEP_UP_REQUIRED",
					scope: "org.credentials",
				});
				expect(
					f.database.apikey.find((key) => key.id === f.orgKey.id)?.enabled
				).toBe(true);
				grants.push({
					sessionId: f.sessionId,
					scope: "org.credentials",
					expiresAt: new Date(Date.now() + 60_000),
				});
				const accepted = await f.request(
					action,
					f.orgKey.id,
					"organization",
					transport
				);
				expect(accepted.status).toBe(200);
				const stored = f.database.apikey.find((key) => key.id === f.orgKey.id);
				expect(
					action === "delete" ? stored === undefined : stored?.enabled === false
				).toBe(true);
			});
		}
		it(`rejects expired, wrong-scope and another-session grants for ${action}`, async () => {
			const f = await fixture();
			grants.push(
				{
					sessionId: f.sessionId,
					scope: "org.credentials",
					expiresAt: new Date(Date.now() - 1000),
				},
				{
					sessionId: f.sessionId,
					scope: "billing",
					expiresAt: new Date(Date.now() + 60_000),
				},
				{
					sessionId: "other-session",
					scope: "org.credentials",
					expiresAt: new Date(Date.now() + 60_000),
				}
			);
			expect(
				(await f.request(action, f.orgKey.id, "organization")).status
			).toBe(403);
		});
		it(`does not trust requested config or metadata when gating ${action}`, async () => {
			const f = await fixture();
			for (const configId of [undefined, "default", "organization"]) {
				const response = await f.request(action, f.orgKey.id, configId);
				expect(response.status).toBe(403);
				expect(await response.json()).toMatchObject({
					code: "STEP_UP_REQUIRED",
				});
			}
			expect(
				(await f.request(action, f.personalKey.id, "default")).status
			).toBe(200);
		});
		it(`retains native organization ownership checks after proof for ${action}`, async () => {
			const f = await fixture();
			grants.push({
				sessionId: f.sessionId,
				scope: "org.credentials",
				expiresAt: new Date(Date.now() + 60_000),
			});
			f.database.member.length = 0;
			expect(
				(await f.request(action, f.orgKey.id, "organization")).status
			).toBe(403);
			expect(
				f.database.apikey.find((key) => key.id === f.orgKey.id)?.enabled
			).toBe(true);
		});
	}
});
