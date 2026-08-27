import { describe, expect, test } from "bun:test";
import {
	normalizePromptfooConfig,
	parsePromptfooFile,
	serializePromptfooConfig,
} from "./promptfoo.ts";

describe("Promptfoo config normalization", () => {
	test("keeps typed vars, default tests, chat prompts, and assertion options", () => {
		const config = normalizePromptfooConfig({
			defaultTest: {
				vars: { locale: "en" },
				assert: [{ type: "contains", value: "{{answer}}", weight: 2 }],
			},
			prompts: [
				{
					id: "chat",
					messages: [{ role: "user", content: "Hello {{name}}" }],
				},
			],
			providers: [{ id: "openai:gpt-4o" }],
			tests: [{ vars: { name: "Sam", answer: 42 } }],
		});

		expect(config.prompts[0]?.type).toBe("chat");
		expect(config.providers).toEqual(["openai:gpt-4o"]);
		expect(config.tests[0]?.vars).toEqual({
			answer: 42,
			locale: "en",
			name: "Sam",
		});
		expect(config.tests[0]?.assertions[0]).toMatchObject({
			kind: "contains",
			options: { weight: 2 },
		});
	});

	test("parses CSV and exports all supported dataset formats", () => {
		const parsed = parsePromptfooFile(
			'description,prompt,vars,expected\nGreeting,"Hi, {{name}}","{""name"":""Sam""}",hello',
			"cases.csv"
		);
		expect(parsed.format).toBe("csv");
		expect(parsed.config.tests[0]?.vars).toEqual({ name: "Sam" });
		expect(parsed.config.tests[0]?.prompt).toBe("Hi, {{name}}");

		for (const format of ["yaml", "json", "jsonl", "csv"] as const) {
			const output = serializePromptfooConfig(parsed.config, format);
			expect(output.length).toBeGreaterThan(0);
		}
	});
});
