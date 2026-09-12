import { expect, test } from "bun:test";
import { completeComposioConnection } from "./composio.ts";

test("completion carries Core identity headers and only the callback session body", async () => {
	let seen: Request | undefined;
	const result = await completeComposioConnection(
		{
			url: "https://node.example.test",
			token: "node-token",
			userJwt: "verified-user",
			fetch: async (input, init) => {
				seen = new Request(input, init);
				return Response.json({
					id: "account",
					toolkit: "gmail",
					status: "ACTIVE",
					active: true,
					private: "not-returned",
				});
			},
		},
		"callback-session"
	);
	expect(seen?.url).toBe(
		"https://node.example.test/api/composio/connections/complete"
	);
	expect(seen?.method).toBe("POST");
	expect(seen?.headers.get("authorization")).toBe("Bearer node-token");
	expect(seen?.headers.get("x-ryu-user-jwt")).toBe("verified-user");
	expect(await seen?.json()).toEqual({ sessionUri: "callback-session" });
	expect(result).toEqual({
		id: "account",
		toolkit: "gmail",
		status: "ACTIVE",
		active: true,
	});
});

test("completion rejects invalid input before I/O and unconfirmed responses", async () => {
	let calls = 0;
	const target = {
		url: "https://node.example.test",
		token: "node-token",
		fetch: async () => {
			calls++;
			return Response.json({
				id: "account",
				toolkit: "gmail",
				status: "INITIATED",
				active: false,
			});
		},
	};
	for (const value of ["", "a".repeat(4097), "界".repeat(1366)]) {
		await expect(completeComposioConnection(target, value)).rejects.toThrow(
			"Invalid callback"
		);
	}
	expect(calls).toBe(0);
	await expect(completeComposioConnection(target, "session")).rejects.toThrow(
		"did not confirm"
	);
});
