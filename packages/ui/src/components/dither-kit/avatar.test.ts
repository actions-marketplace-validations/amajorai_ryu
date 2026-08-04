import { describe, expect, test } from "bun:test";
import { ditherAvatarSeed } from "./avatar.tsx";

describe("ditherAvatarSeed", () => {
	test("the same user id yields the same seed regardless of email or name", () => {
		const a = ditherAvatarSeed({
			id: "user_abc",
			email: "a@x.com",
			name: "Alice",
		});
		const renamed = ditherAvatarSeed({
			id: "user_abc",
			email: "renamed@x.com",
			name: "Alicia",
		});
		expect(a).toBe(renamed);
	});

	test("two different users with the same name get different seeds", () => {
		const one = ditherAvatarSeed({ id: "u1", name: "John" });
		const two = ditherAvatarSeed({ id: "u2", name: "John" });
		expect(one).not.toBe(two);
	});

	test("falls back id -> email -> name -> ryu", () => {
		expect(ditherAvatarSeed({ email: "e@x.com", name: "N" })).toBe("e@x.com");
		expect(ditherAvatarSeed({ name: "N" })).toBe("N");
		expect(ditherAvatarSeed({})).toBe("ryu");
		expect(
			ditherAvatarSeed({ id: "i", email: "e@x.com", name: "N" })
		).toBe("i");
	});

	test("null fields fall through to the next candidate", () => {
		expect(
			ditherAvatarSeed({ id: null, email: "e@x.com", name: null })
		).toBe("e@x.com");
	});
});
