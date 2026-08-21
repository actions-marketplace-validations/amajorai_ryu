import { expect, test } from "bun:test";
import {
	formatPrivatePackageShareCode,
	normalizePrivatePackageShareCode,
	previewPrivatePackageShareCode,
	redeemPrivatePackageShareCode,
} from "./marketplace.ts";

test("normalizes private package codes entered with spaces or hyphens", () => {
	expect(normalizePrivatePackageShareCode("7k4m-x2qp-9f6d")).toBe(
		"7K4MX2QP9F6D"
	);
	expect(formatPrivatePackageShareCode("7K4MX2QP9F6D")).toBe("7K4M-X2QP-9F6D");
});

test("keeps incomplete codes readable while the user is typing", () => {
	expect(formatPrivatePackageShareCode("7K4M")).toBe("7K4M");
	expect(formatPrivatePackageShareCode("7K4MX2")).toBe("7K4M-X2");
});

test("reads the safe listing envelope and install session wire aliases", async () => {
	const originalFetch = globalThis.fetch;
	let call = 0;
	globalThis.fetch = (async () => {
		call += 1;
		return Response.json(
			call === 1
				? {
						audience: "shareable",
						expiresAt: "2026-09-19T00:00:00.000Z",
						listing: {
							connections: [
								{
									display_name: "Google Drive",
									id: "google-drive",
									provider: "composio",
									required: true,
									toolkit: "GOOGLEDRIVE",
								},
							],
							id: "acme/report",
							kind: "workflow",
							name: "Customer report",
							version: "1.0.0",
						},
					}
				: {
						audience: "shareable",
						installSessionToken: "short-lived-session",
						listing: {
							id: "acme/report",
							kind: "workflow",
							name: "Customer report",
							version: "1.0.0",
						},
					}
		);
	}) as unknown as typeof fetch;
	try {
		const preview = await previewPrivatePackageShareCode("7K4M-X2QP-9F6D");
		expect(preview.audience).toBe("shareable");
		expect(preview.expiresAt).toBe("2026-09-19T00:00:00.000Z");
		expect(preview.connections[0]).toMatchObject({
			displayName: "Google Drive",
			toolkit: "GOOGLEDRIVE",
		});
		const redeemed = await redeemPrivatePackageShareCode("7K4MX2QP9F6D");
		expect(redeemed.installSession).toBe("short-lived-session");
		expect(redeemed.preview.id).toBe("acme/report");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
