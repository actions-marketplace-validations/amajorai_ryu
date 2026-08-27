import { describe, expect, test } from "bun:test";
import { normalizeSandboxToast, sandboxToast } from "./sandbox-toast.ts";

describe("sandbox toast", () => {
	test("normalizes string and options call shapes", () => {
		expect(normalizeSandboxToast("Saved")).toEqual({ title: "Saved" });
		expect(
			normalizeSandboxToast("Saved", {
				description: "All done",
				duration: 1000,
			})
		).toEqual({ description: "All done", duration: 1000, title: "Saved" });
		expect(
			normalizeSandboxToast({ title: "Saved", description: "All done" })
		).toEqual({
			description: "All done",
			title: "Saved",
		});
	});

	test("is safe to call in a non-DOM test or standalone process", () => {
		expect(() => sandboxToast.success("Saved")).not.toThrow();
		expect(() => sandboxToast.error({ title: "Failed" })).not.toThrow();
	});
});
