import { describe, expect, it } from "bun:test";
import { installerComponentLabel } from "./installer-progress.ts";

describe("installer progress labels", () => {
	it("uses the product names shared by onboarding and background toasts", () => {
		expect(installerComponentLabel("ryu-core")).toBe("Ryu Core");
		expect(installerComponentLabel("ryu-gateway")).toBe("the model gateway");
		expect(installerComponentLabel("bundled-defaults")).toBe(
			"bundled models, engines, and skills"
		);
	});

	it("keeps unknown installer components visible", () => {
		expect(installerComponentLabel("future-sidecar")).toBe("future-sidecar");
	});
});
