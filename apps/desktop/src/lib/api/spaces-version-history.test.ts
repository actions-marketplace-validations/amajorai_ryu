import { afterEach, describe, expect, it } from "bun:test";
import {
	listDocumentVersions,
	restoreDocumentVersion,
	updateDocument,
} from "./spaces.ts";

const originalFetch = globalThis.fetch;
const target = { token: null, url: "https://node.test" };

function installFetch(handler: typeof globalThis.fetch): void {
	globalThis.fetch = handler;
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("Spaces version-history API", () => {
	it("sends revision guards and maps an accepted write receipt", async () => {
		let captured: RequestInit | undefined;
		installFetch(
			Object.assign(
				async (_input: RequestInfo | URL, init?: RequestInit) => {
					captured = init;
					return Response.json({
						result: {
							changed: true,
							duplicate: false,
							revision: 8,
							updated_at: 1234,
							version_id: "dv_auto",
						},
						success: true,
					});
				},
				{ preconnect: originalFetch.preconnect }
			)
		);

		const result = await updateDocument(
			target,
			"space",
			"document",
			"Plan",
			"New copy",
			{ expectedRevision: 7, operationId: "write-7" }
		);

		expect(captured?.method).toBe("PUT");
		expect(JSON.parse(String(captured?.body))).toEqual({
			expected_revision: 7,
			operation_id: "write-7",
			source: "New copy",
			title: "Plan",
		});
		expect(result).toEqual({
			changed: true,
			duplicate: false,
			revision: 8,
			updatedAt: 1234,
			versionId: "dv_auto",
		});
	});

	it("maps checkpoint provenance while remaining compatible with legacy rows", async () => {
		installFetch(
			Object.assign(
				async () =>
					Response.json([
						{
							capture_type: "automatic",
							created_at: 100,
							created_by: "alice",
							document_id: "document",
							granularity: "hour",
							id: "modern",
							kind: "page",
							label: null,
							revision: 4,
							title: "Plan",
							updated_at: 200,
						},
						{
							created_at: 50,
							document_id: "document",
							id: "legacy",
							kind: "page",
							title: "Plan",
						},
					]),
				{ preconnect: originalFetch.preconnect }
			)
		);

		const [modern, legacy] = await listDocumentVersions(
			target,
			"space",
			"document"
		);
		expect(modern).toMatchObject({
			captureType: "automatic",
			createdBy: "alice",
			granularity: "hour",
			revision: 4,
			updatedAt: 200,
		});
		expect(legacy).toMatchObject({
			captureType: "manual",
			createdBy: null,
			granularity: "exact",
			revision: 0,
			updatedAt: 50,
		});
	});

	it("guards restore with the revision and operation id", async () => {
		let captured: RequestInit | undefined;
		installFetch(
			Object.assign(
				async (_input: RequestInfo | URL, init?: RequestInit) => {
					captured = init;
					return Response.json({
						result: {
							changed: true,
							duplicate: false,
							revision: 9,
							updated_at: 2000,
							version_id: "dv_guard",
						},
						success: true,
					});
				},
				{ preconnect: originalFetch.preconnect }
			)
		);

		const result = await restoreDocumentVersion(
			target,
			"space",
			"document",
			"version",
			{ expectedRevision: 8, operationId: "restore-8" }
		);

		expect(captured?.method).toBe("POST");
		expect(JSON.parse(String(captured?.body))).toEqual({
			expected_revision: 8,
			operation_id: "restore-8",
		});
		expect(result.revision).toBe(9);
		expect(result.versionId).toBe("dv_guard");
	});
});
