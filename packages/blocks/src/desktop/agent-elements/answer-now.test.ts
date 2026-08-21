import { expect, test } from "bun:test";
import { answerNowDelayMs } from "./answer-now.ts";

test("gives higher reasoning effort a longer grace period", () => {
	expect(answerNowDelayMs("low")).toBeLessThan(answerNowDelayMs("high"));
	expect(answerNowDelayMs("high")).toBeLessThan(answerNowDelayMs("max"));
});

test("uses the default grace period for an unlabelled model effort", () => {
	expect(answerNowDelayMs()).toBe(2200);
	expect(answerNowDelayMs("unknown")).toBe(2200);
});
