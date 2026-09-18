import { expect, test } from "bun:test";
import { nativeControlPlaneFixture } from "./native-control-plane-fixture.ts";

test("native fixture serves only explicit reads and keeps its origin boundary", async () => {
	const request = (
		path: string,
		method = "GET",
		origin = "http://127.0.0.1:5225"
	) =>
		new Request(`http://127.0.0.1:5235${path}`, {
			method,
			headers: { origin },
		});
	const session = nativeControlPlaneFixture(request("/api/auth/get-session"));
	expect(session.status).toBe(200);
	expect((await session.json()).user.id).toBe("native-proof-user");
	expect(session.headers.get("Access-Control-Allow-Origin")).toBe(
		"http://127.0.0.1:5225"
	);
	expect(session.headers.get("Cache-Control")).toBe("no-store");
	expect(
		nativeControlPlaneFixture(
			request("/api/auth/get-session", "GET", "https://other.example")
		).status
	).toBe(403);
	expect(
		nativeControlPlaneFixture(request("/api/auth/get-session", "POST")).status
	).toBe(405);
	expect(nativeControlPlaneFixture(request("/api/unknown")).status).toBe(501);
	expect(
		nativeControlPlaneFixture(request("/api/auth/get-session", "OPTIONS"))
			.status
	).toBe(204);
	expect(
		(await nativeControlPlaneFixture(request("/api/waitlist/me")).json()).status
	).toBe("approved");
	expect(
		await nativeControlPlaneFixture(
			request("/api/auth/organization/list")
		).json()
	).toEqual([]);
});

test("fixture boundaries hold over a real loopback HTTP connection", async () => {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: nativeControlPlaneFixture,
	});
	try {
		const session = await fetch(new URL("/api/auth/get-session", server.url), {
			headers: { origin: "http://127.0.0.1:5225" },
		});
		expect(session.status).toBe(200);
		expect((await session.json()).user.id).toBe("native-proof-user");
		const foreign = await fetch(new URL("/api/auth/get-session", server.url), {
			headers: { origin: "https://other.example" },
		});
		expect(foreign.status).toBe(403);
		await foreign.arrayBuffer();
		const write = await fetch(new URL("/api/auth/sign-out", server.url), {
			method: "POST",
		});
		expect(write.status).toBe(405);
		await write.arrayBuffer();
	} finally {
		await server.stop(true);
	}
});
