import { describe, expect, test } from "bun:test";
import {
	ModelAgentPicker,
	modelOptionsForCatalog,
	RyuRuntimePicker,
} from "./runtime-picker.tsx";

describe("runtime picker block", () => {
	test("keeps one canonical picker export for every host", () => {
		expect(RyuRuntimePicker).toBe(ModelAgentPicker);
		expect(modelOptionsForCatalog).toBeFunction();
	});
});
