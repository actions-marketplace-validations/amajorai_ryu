// Synthetic local session for native UI proofs; never a production auth service.
/** Local UI-test responses only. No real accounts, credentials, or billing state. */
const ORIGINS = new Set(["http://127.0.0.1:5225", "http://localhost:5225"]);

export function nativeControlPlaneFixture(request: Request): Response {
	const origin = request.headers.get("origin");
	if (origin && !ORIGINS.has(origin)) {
		return Response.json(
			{ error: "Origin is outside the native proof" },
			{ status: 403 }
		);
	}
	const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
	if (origin) {
		headers.set("Access-Control-Allow-Origin", origin);
		headers.set("Access-Control-Allow-Credentials", "true");
	}
	if (request.method === "OPTIONS") {
		headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
		headers.set("Access-Control-Allow-Headers", "authorization, content-type");
		return new Response(null, { status: 204, headers });
	}
	if (request.method !== "GET") {
		return Response.json(
			{ error: "This fixture does not implement writes" },
			{ status: 405, headers }
		);
	}
	const path = new URL(request.url).pathname;
	if (path === "/api/auth/get-session") {
		return Response.json(
			{
				session: {
					id: "native-proof-session",
					token: "native-proof-fixture-only",
					userId: "native-proof-user",
					expiresAt: "2099-01-01T00:00:00.000Z",
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
				user: {
					id: "native-proof-user",
					name: "Native Performance Fixture",
					email: "native-proof@example.test",
					emailVerified: true,
					isAnonymous: false,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			},
			{ headers }
		);
	}
	if (path === "/api/waitlist/me") {
		return Response.json(
			{
				status: "approved",
				applicationStatus: "approved",
				hasApplied: true,
				isAdmin: false,
				username: "native-proof",
				displayUsername: "native-proof",
				joinedAt: "2026-01-01T00:00:00.000Z",
				position: null,
				eta: null,
				referralCode: null,
				referralCount: 0,
				referralUrl: null,
				totalWaiting: 0,
			},
			{ headers }
		);
	}
	if (path === "/api/auth/organization/list") {
		return Response.json([], { headers });
	}
	return Response.json(
		{ error: "Unimplemented native proof route", path },
		{ status: 501, headers }
	);
}

if (import.meta.main) {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 5235,
		fetch: nativeControlPlaneFixture,
	});
	process.stdout.write(`Native UI fixture listening on ${server.url.origin}\n`);
}
