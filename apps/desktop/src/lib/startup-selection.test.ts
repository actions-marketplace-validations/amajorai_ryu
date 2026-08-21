import { describe, expect, it } from "bun:test";
import { startupSelectionSteps } from "./startup-selection.ts";

const accounts = [{ userId: "a" }, { userId: "b" }];
const nodes = [{ name: "local" }, { name: "remote" }];

describe("startup selection steps", () => {
	it("asks for both choices in always mode", () => {
		expect(
			startupSelectionSteps({
				accounts,
				defaultAccountId: "a",
				defaultNodeName: "local",
				mode: "always",
				nodes,
			})
		).toEqual({ account: true, node: true });
	});

	it("only asks for missing defaults", () => {
		expect(
			startupSelectionSteps({
				accounts,
				defaultAccountId: "a",
				defaultNodeName: null,
				mode: "defaults",
				nodes,
			})
		).toEqual({ account: false, node: true });
	});

	it("does not show on startup when the preference is never", () => {
		expect(
			startupSelectionSteps({
				accounts,
				defaultAccountId: null,
				defaultNodeName: null,
				mode: "never",
				nodes,
			})
		).toEqual({ account: false, node: false });
	});

	it("does not ask for a single account or node", () => {
		expect(
			startupSelectionSteps({
				accounts: [{ userId: "a" }],
				defaultAccountId: null,
				defaultNodeName: null,
				mode: "defaults",
				nodes: [{ name: "local" }],
			})
		).toEqual({ account: false, node: false });
	});
});
