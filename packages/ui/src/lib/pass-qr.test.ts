import { describe, expect, test } from "bun:test";
import { passQrColors } from "./pass-qr.ts";

describe("passQrColors", () => {
	test("keeps the seeded hue while preserving a quiet light surface", () => {
		const colors = passQrColors(212, false);

		expect(colors.surface).toMatch(/^#[0-9a-f]{6}$/);
		expect(colors.foreground).toMatch(/^#[0-9a-f]{6}$/);
		expect(colors.glow).toStartWith("rgba(");
		expect(colors.surface).not.toBe("#ffffff");
	});

	test("raises the code above the face in dark mode", () => {
		const light = passQrColors(212, false);
		const dark = passQrColors(212, true);

		expect(dark.foreground).not.toBe(light.foreground);
		expect(dark.surface).not.toBe(light.surface);
	});
});
