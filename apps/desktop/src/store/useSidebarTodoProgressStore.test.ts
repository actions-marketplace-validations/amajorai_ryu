import { describe, expect, it } from "bun:test";
import type { TodoProgressMessage } from "@/src/lib/todo-progress.ts";
import {
	ensureSidebarTodoProgress,
	publishSidebarTodoProgress,
	useSidebarTodoProgressStore,
} from "./useSidebarTodoProgressStore.ts";

describe("useSidebarTodoProgressStore", () => {
	it("deduplicates same-revision loads", async () => {
		let calls = 0;
		const loadMessages = async (): Promise<readonly TodoProgressMessage[]> => {
			calls += 1;
			return [
				{
					parts: [
						{
							type: "tool-TodoWrite",
							input: {
								todos: [{ content: "Build", status: "in_progress" }],
							},
						},
					],
				},
			];
		};

		await Promise.all([
			ensureSidebarTodoProgress({
				conversationId: "chat-dedup",
				key: "node/chat-dedup",
				loadMessages,
				revision: 1,
			}),
			ensureSidebarTodoProgress({
				conversationId: "chat-dedup",
				key: "node/chat-dedup",
				loadMessages,
				revision: 1,
			}),
		]);

		expect(calls).toBe(1);
		expect(
			useSidebarTodoProgressStore.getState().entries["node/chat-dedup"]
				?.progress?.hasInProgress
		).toBe(true);
	});

	it("publishes live snapshots and invalidates on a newer revision", async () => {
		const completeMessages: readonly TodoProgressMessage[] = [
			{
				parts: [
					{
						type: "tool-TodoWrite",
						input: {
							todos: [{ content: "Build", status: "completed" }],
						},
					},
				],
			},
		];
		publishSidebarTodoProgress({
			key: "node/chat-live",
			messages: completeMessages,
			revision: 4,
		});
		expect(
			useSidebarTodoProgressStore.getState().entries["node/chat-live"]?.progress
				?.isComplete
		).toBe(true);

		await ensureSidebarTodoProgress({
			conversationId: "chat-live",
			key: "node/chat-live",
			loadMessages: async () => [],
			revision: 5,
		});
		expect(
			useSidebarTodoProgressStore.getState().entries["node/chat-live"]?.revision
		).toBe(5);
		expect(
			useSidebarTodoProgressStore.getState().entries["node/chat-live"]?.progress
		).toBeNull();
	});

	it("records loader failures without throwing into the row", async () => {
		await ensureSidebarTodoProgress({
			conversationId: "chat-error",
			key: "node/chat-error",
			loadMessages: async () => {
				throw new Error("offline");
			},
			revision: 1,
		});

		expect(
			useSidebarTodoProgressStore.getState().entries["node/chat-error"]
		).toEqual({
			progress: null,
			revision: 1,
			status: "error",
		});
	});

	it("allows a live snapshot to replace a persisted snapshot at one revision", async () => {
		let calls = 0;
		const key = "node/chat-live-replacement";
		await ensureSidebarTodoProgress({
			conversationId: "chat-live-replacement",
			key,
			loadMessages: async () => {
				calls += 1;
				return [
					{
						parts: [
							{
								type: "tool-TodoWrite",
								input: {
									todos: [{ content: "Build", status: "in_progress" }],
								},
							},
						],
					},
				];
			},
			revision: 9,
		});

		publishSidebarTodoProgress({
			key,
			messages: [
				{
					parts: [
						{
							type: "tool-TodoWrite",
							input: {
								todos: [{ content: "Build", status: "completed" }],
							},
						},
					],
				},
			],
			revision: 9,
		});

		expect(calls).toBe(1);
		expect(
			useSidebarTodoProgressStore.getState().entries[key]?.progress?.isComplete
		).toBe(true);
	});
});
