import { describe, expect, test } from "bun:test";

import {
	browserModelCapabilities,
	browserModelCatalog,
	CURATED_BROWSER_MODELS,
	createBrowserModelDefinition,
	DEFAULT_BROWSER_MODEL_ID,
	isValidBrowserModelId,
} from "./catalog.ts";

describe("browser model catalog", () => {
	test("keeps a safe curated default", () => {
		expect(DEFAULT_BROWSER_MODEL_ID).toBe("onnx-community/SmolLM2-135M-ONNX");
		expect(
			CURATED_BROWSER_MODELS.every((model) => model.task === "text-generation")
		).toBe(true);
	});

	test("rejects URLs and traversal-looking model ids", () => {
		for (const modelId of [
			"https://huggingface.co/acme/model",
			"../secret/model",
			"acme/model/revision",
			"acme model",
		]) {
			expect(isValidBrowserModelId(modelId)).toBe(false);
		}
		expect(isValidBrowserModelId("acme/model-name_q4")).toBe(true);
	});

	test("does not grant actions to unreviewed custom models", () => {
		expect(browserModelCapabilities("acme/model").actionSupport).toBe(false);
		expect(browserModelCapabilities("acme/qwen-model").actionSupport).toBe(
			true
		);
		expect(createBrowserModelDefinition("acme/model").curated).toBe(false);
	});

	test("merges runtime status into the curated catalog", () => {
		const catalog = browserModelCatalog(
			new Map([
				[
					DEFAULT_BROWSER_MODEL_ID,
					{ status: "preparing", statusMessage: "Downloading" },
				],
			])
		);
		expect(catalog[0]).toMatchObject({
			id: DEFAULT_BROWSER_MODEL_ID,
			status: "preparing",
			statusMessage: "Downloading",
		});
	});
});
