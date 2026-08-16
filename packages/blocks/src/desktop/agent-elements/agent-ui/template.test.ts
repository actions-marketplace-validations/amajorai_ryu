import { describe, expect, it } from "bun:test";
import {
	parseAgentUiTemplateInput,
	safeParseAgentUiTemplate,
	safeParseAgentUiTemplateInput,
} from "./template.ts";

const spec = {
	root: "card",
	elements: {
		card: {
			type: "Card",
			props: { title: "Approval" },
			children: ["message", "approve"],
		},
		message: {
			type: "Text",
			props: { text: "Deploy this change?" },
			children: [],
		},
		approve: {
			type: "Button",
			props: { label: "Approve" },
			children: [],
		},
	},
};

const input = {
	name: "Deployment approval",
	description: "A reusable approval prompt",
	tags: ["approval", "deploy"],
	spec,
	params: [{ name: "environment", type: "string", required: true }],
	source: "user",
};

describe("AgentUiTemplateSchema", () => {
	it("accepts a valid closed-vocabulary template input", () => {
		expect(parseAgentUiTemplateInput(input)).toMatchObject({
			name: "Deployment approval",
			source: "user",
		});
	});

	it("rejects unknown components and dangling children", () => {
		const result = safeParseAgentUiTemplateInput({
			...input,
			spec: {
				root: "root",
				elements: {
					root: {
						type: "NotInTheCatalog",
						props: {},
						children: ["missing"],
					},
				},
			},
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(
				result.error.issues.map((issue) => issue.message).join(" ")
			).toContain("Unknown Agent-UI component");
			expect(
				result.error.issues.map((issue) => issue.message).join(" ")
			).toContain("references missing child");
		}
	});

	it("rejects cyclic element trees and duplicate parameter names", () => {
		const result = safeParseAgentUiTemplateInput({
			...input,
			params: [
				{ name: "environment", type: "string" },
				{ name: "environment", type: "string" },
			],
			spec: {
				root: "a",
				elements: {
					a: { type: "Stack", props: {}, children: ["b"] },
					b: { type: "Stack", props: {}, children: ["a"] },
				},
			},
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			const messages = result.error.issues
				.map((issue) => issue.message)
				.join(" ");
			expect(messages).toContain("cycles");
			expect(messages).toContain("Duplicate template parameter");
		}
	});

	it("validates persisted identity and timestamps", () => {
		const result = safeParseAgentUiTemplate({
			...input,
			id: "deployment-approval",
			createdAt: "2026-08-16T00:00:00.000Z",
			updatedAt: "2026-08-16T00:00:00.000Z",
		});
		expect(result.success).toBe(true);
	});

	it("rejects unsafe persisted identity", () => {
		const result = safeParseAgentUiTemplate({
			...input,
			id: "../template",
			createdAt: "2026-08-16T00:00:00.000Z",
			updatedAt: "2026-08-16T00:00:00.000Z",
		});
		expect(result.success).toBe(false);
	});
});
