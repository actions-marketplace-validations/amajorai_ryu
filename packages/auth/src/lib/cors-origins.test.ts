import { describe, expect, it } from "bun:test";
import {
	DEFAULT_EXTENSION_ORIGIN,
	resolveRyuCorsOrigins,
} from "./cors-origins.ts";

describe("resolveRyuCorsOrigins", () => {
	it("keeps shipped app origins when an operator configures web CORS", () => {
		const origins = resolveRyuCorsOrigins({
			corsOrigin: "https://ryuhq.com",
			frontendUrl: "https://ryuhq.com/login",
			webappUrl: "https://app.ryuhq.com/path",
		});

		expect(origins).toContain("https://ryuhq.com");
		expect(origins).toContain("https://app.ryuhq.com");
		expect(origins).toContain(DEFAULT_EXTENSION_ORIGIN);
		expect(origins).toContain("ryu://");
		expect(origins).toContain("tauri://localhost");
	});

	it("honors an overridden extension origin", () => {
		const origins = resolveRyuCorsOrigins({
			corsOrigin: "https://ryuhq.com",
			extensionOrigin: "chrome-extension://custom",
		});
		expect(origins).toContain("chrome-extension://custom");
		expect(origins).not.toContain(DEFAULT_EXTENSION_ORIGIN);
	});
});
