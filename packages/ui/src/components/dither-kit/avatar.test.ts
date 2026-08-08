import { describe, expect, test } from "bun:test";
import { ditherAvatarSeed } from "./avatar.tsx";

describe("ditherAvatarSeed", () => {
	test("the handle wins over every other field", () => {
		expect(
			ditherAvatarSeed({
				id: "user_abc",
				email: "a@x.com",
				name: "Alice",
				username: "alice",
			})
		).toBe("alice");
	});

	test("the seed is the same one the pass paints its backdrop from", () => {
		// The membership pass seeds its warp backdrop off `username || name`. The
		// avatar has to land on the same string or the card is two colours.
		const handled = { id: "u1", email: "a@x.com", name: "Alice", username: "al" };
		expect(ditherAvatarSeed(handled)).toBe(handled.username);
		const unhandled = { id: "u2", email: "b@x.com", name: "Bob" };
		expect(ditherAvatarSeed(unhandled)).toBe(unhandled.name);
	});

	test("falls back username -> name -> email -> id -> ryu", () => {
		expect(ditherAvatarSeed({ name: "N", email: "e@x.com", id: "i" })).toBe("N");
		expect(ditherAvatarSeed({ email: "e@x.com", id: "i" })).toBe("e@x.com");
		expect(ditherAvatarSeed({ id: "i" })).toBe("i");
		expect(ditherAvatarSeed({})).toBe("ryu");
	});

	test("null fields fall through to the next candidate", () => {
		expect(
			ditherAvatarSeed({ username: null, name: null, email: "e@x.com" })
		).toBe("e@x.com");
	});
});
