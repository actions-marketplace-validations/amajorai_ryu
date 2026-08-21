import { describe, expect, it } from "bun:test";
import { messageNeedsWorkspace } from "./workspace-intent.ts";

describe("messageNeedsWorkspace", () => {
	it("recognizes explicit local project work", () => {
		expect(messageNeedsWorkspace("Fix the failing tests in this repo")).toBe(
			true
		);
		expect(messageNeedsWorkspace("Create a README file for the project")).toBe(
			true
		);
		expect(messageNeedsWorkspace("Run the tests")).toBe(true);
		expect(messageNeedsWorkspace("Create a pull request")).toBe(true);
	});

	it("does not block ordinary questions", () => {
		expect(messageNeedsWorkspace("What is a Git branch?")).toBe(false);
		expect(messageNeedsWorkspace("Explain how folders work")).toBe(false);
		expect(messageNeedsWorkspace("Tell me about component design")).toBe(false);
		expect(messageNeedsWorkspace("How do I build a project?")).toBe(false);
	});

	it("still recognizes a direct request phrased as a question", () => {
		expect(
			messageNeedsWorkspace("Can you fix the failing tests in this repo?")
		).toBe(true);
	});
});
