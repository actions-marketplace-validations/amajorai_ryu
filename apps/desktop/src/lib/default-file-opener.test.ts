import { describe, expect, it } from "bun:test";
import {
	DEFAULT_FILE_OPENER_VALUES,
	isDefaultFileOpener,
	normalizeDefaultFileOpener,
} from "./default-file-opener.ts";

describe("default file opener", () => {
	it("keeps the OS opener as the default", () => {
		expect(normalizeDefaultFileOpener(null)).toBe("system");
		expect(normalizeDefaultFileOpener("unknown")).toBe("system");
	});

	it("accepts only supported editor targets", () => {
		expect(DEFAULT_FILE_OPENER_VALUES).toEqual([
			"system",
			"vscode",
			"cursor",
			"zed",
		]);
		expect(isDefaultFileOpener("cursor")).toBe(true);
		expect(isDefaultFileOpener("terminal")).toBe(false);
	});
});
