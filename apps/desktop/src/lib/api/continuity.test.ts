import { describe, expect, it } from "bun:test";
import type { RnpContinuityBundleV0 } from "@ryuhq/protocol/continuity";
import { createContinuityClient } from "./continuity.ts";

const bundle: RnpContinuityBundleV0 = {
	protocol: "ryu-node-continuity",
	version: 0,
	bundleId: "bundle-1",
	createdAt: 20,
	source: { conversationId: "conversation-1", updatedAt: 10 },
	selection: {
		transcript: { mode: "recent", maxMessages: 50 },
		omittedEarlierMessages: false,
	},
	messages: [],
	context: { version: 0, items: [] },
};

describe("RNP continuity client", () => {
	it("keeps source and destination credentials on their own requests", async () => {
		const calls: Array<{
			target: { url: string; token: string | null };
			path: string;
		}> = [];
		const client = createContinuityClient({
			send: ({ target, path }) => {
				calls.push({ target, path });
				return Promise.resolve(
					path.endsWith("/export")
						? bundle
						: {
								version: 0,
								conversationId: "conversation-1",
								status: "created",
								imported: { messages: 0, contextItems: 0 },
								warnings: [],
							}
				);
			},
		});

		await client.transferConversation({
			conversationId: "conversation-1",
			source: { url: "https://source.example", token: "source-secret" },
			destination: {
				url: "https://destination.example",
				token: "destination-secret",
			},
		});

		expect(calls).toEqual([
			{
				target: { url: "https://source.example", token: "source-secret" },
				path: "/api/rnp/v0/conversations/conversation-1/export",
			},
			{
				target: {
					url: "https://destination.example",
					token: "destination-secret",
				},
				path: "/api/rnp/v0/conversations/conversation-1/resume",
			},
		]);
	});

	it("does not contact the destination when source validation fails", async () => {
		let calls = 0;
		const client = createContinuityClient({
			send: () => {
				calls += 1;
				return Promise.resolve({ protocol: "wrong", version: 0 });
			},
		});

		await expect(
			client.transferConversation({
				conversationId: "conversation-1",
				source: { url: "https://source.example", token: null },
				destination: { url: "https://destination.example", token: null },
			})
		).rejects.toThrow("invalid continuity bundle");
		expect(calls).toBe(1);
	});

	it("rejects mismatched ids and invalid imported counts at the boundary", async () => {
		const mismatchedSource = createContinuityClient({
			send: () =>
				Promise.resolve({
					...bundle,
					source: { ...bundle.source, conversationId: "different" },
				}),
		});
		await expect(
			mismatchedSource.exportConversation(
				{ url: "https://source.example", token: null },
				"conversation-1",
				{ version: 0, transcript: { mode: "recent", maxMessages: 50 } }
			)
		).rejects.toThrow("different conversation");

		const invalidResume = createContinuityClient({
			send: () =>
				Promise.resolve({
					version: 0,
					conversationId: "conversation-1",
					status: "merged",
					imported: { messages: -1, contextItems: 0 },
					warnings: [],
				}),
		});
		await expect(
			invalidResume.resumeConversation(
				{ url: "https://destination.example", token: null },
				bundle
			)
		).rejects.toThrow("invalid continuity response");
	});
});
