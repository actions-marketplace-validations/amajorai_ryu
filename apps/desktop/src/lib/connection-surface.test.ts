import { describe, expect, it } from "bun:test";
import {
	connectionDisplayName,
	connectionSurfaceMeta,
} from "./connection-surface.ts";

describe("connectionSurfaceMeta", () => {
	it("names the known calling surfaces", () => {
		expect(connectionSurfaceMeta("desktop").label).toBe("Desktop app");
		expect(connectionSurfaceMeta("cli").label).toBe("CLI");
		expect(connectionSurfaceMeta("mobile").label).toBe("Mobile");
		expect(connectionSurfaceMeta("extension").label).toBe("Browser extension");
		expect(connectionSurfaceMeta("web").label).toBe("Web");
	});

	it("keeps an unknown future surface visible", () => {
		expect(connectionSurfaceMeta("watch")).toMatchObject({
			label: "Watch",
			known: false,
		});
	});
});

describe("connectionDisplayName", () => {
	it("prefers human identity before client label and anonymous fallback", () => {
		const base = {
			clientId: "client-1",
			clientLabel: "Phone",
			firstSeen: 1,
			lastSeen: 2,
			surface: "mobile",
			userId: null,
			userName: null,
		};
		expect(connectionDisplayName({ ...base, userName: "Jiawei" })).toBe(
			"Jiawei"
		);
		expect(connectionDisplayName(base)).toBe("Phone");
		expect(
			connectionDisplayName({ ...base, clientLabel: null, surface: null })
		).toBe("Anonymous");
	});
});
