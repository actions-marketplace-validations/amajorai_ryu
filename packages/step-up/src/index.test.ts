import { describe, expect, it } from "bun:test";
import { isStepUpBlocking, stepUpPromptLine } from "./index.ts";

describe("billing step-up presentation", () => {
	it("marks billing confirmation as blocking", () => {
		expect(isStepUpBlocking("billing")).toBe(true);
		expect(isStepUpBlocking("org.delete")).toBe(false);
	});

	it("names the authenticator code", () => {
		expect(
			stepUpPromptLine({
				action: "complete this billing action",
				method: "totp",
			})
		).toBe(
			"Enter the code from your authenticator app to complete this billing action."
		);
	});
});
