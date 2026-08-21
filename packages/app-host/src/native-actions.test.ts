import { describe, expect, it } from "bun:test";

import {
	capabilitiesFromGrants,
	dispatchRpc,
	type HostServices,
	NATIVE_ACTION_LIMITS,
} from "./rpc.ts";

const nativeCapabilities = capabilitiesFromGrants([
	"native:haptics",
	"native:notifications",
	"native:live_activities",
]);

const baseServices: Pick<HostServices, "listAgents" | "registerRoute"> = {
	listAgents: async () => [],
	registerRoute: async () => ({ path: "/plugin/test" }),
};

describe("bounded native action bridge", () => {
	it("maps only explicit native grants and dispatches validated inputs", async () => {
		const calls: string[] = [];
		const services: HostServices = {
			...baseServices,
			nativeHaptics: (input) => {
				calls.push(`haptic:${input.style}`);
				return { signaled: true };
			},
			nativeNotificationsCreate: async (input) => {
				calls.push(`notification:${input.title}:${input.body}`);
				return { id: "notification-1", scheduled: true };
			},
			nativeLiveActivitiesUpdate: async (input) => {
				calls.push(`activity:${input.conversationId}:${input.status}`);
				return { updated: true };
			},
		};

		await expect(
			dispatchRpc(
				"native.haptics",
				[{ style: "success" }],
				nativeCapabilities,
				services
			)
		).resolves.toEqual({ signaled: true });
		await expect(
			dispatchRpc(
				"native.notifications.create",
				[{ title: "Ready", body: "The task is complete." }],
				nativeCapabilities,
				services
			)
		).resolves.toEqual({ id: "notification-1", scheduled: true });
		await expect(
			dispatchRpc(
				"native.liveActivities.update",
				[
					{
						conversationId: "conversation-1",
						detail: "Waiting for review",
						status: "review",
						title: "Agent run",
					},
				],
				nativeCapabilities,
				services
			)
		).resolves.toEqual({ updated: true });
		expect(calls).toEqual([
			"haptic:success",
			"notification:Ready:The task is complete.",
			"activity:conversation-1:review",
		]);
	});

	it("denies native actions without the matching manifest grant", async () => {
		await expect(
			dispatchRpc("native.haptics", [{ style: "light" }], new Set(), {
				...baseServices,
				nativeHaptics: () => ({ signaled: true }),
			})
		).rejects.toThrow("Capability not granted");
	});

	it("rejects oversized notification and activity text at the RPC boundary", async () => {
		const services: HostServices = {
			...baseServices,
			nativeNotificationsCreate: async () => ({
				id: "never",
				scheduled: true,
			}),
			nativeLiveActivitiesUpdate: async () => ({ updated: true }),
		};
		const oversizedBody = "x".repeat(
			NATIVE_ACTION_LIMITS.notificationBodyChars + 1
		);
		await expect(
			dispatchRpc(
				"native.notifications.create",
				[{ title: "Title", body: oversizedBody }],
				capabilitiesFromGrants(["native:notifications"]),
				services
			)
		).rejects.toThrow("bounded title");
		await expect(
			dispatchRpc(
				"native.liveActivities.update",
				[
					{
						conversationId: "conversation-1",
						detail: "x".repeat(NATIVE_ACTION_LIMITS.detailChars + 1),
						status: "running",
						title: "title",
					},
				],
				capabilitiesFromGrants(["native:live_activities"]),
				services
			)
		).rejects.toThrow("bounded conversationId");
	});

	it("requires host notification permission even when a grant is present", async () => {
		await expect(
			dispatchRpc(
				"native.notifications.create",
				[{ title: "Title", body: "Body" }],
				capabilitiesFromGrants(["native:notifications"]),
				baseServices
			)
		).rejects.toThrow("requires notification permission");
	});

	it("uses an already-granted browser notification without prompting", async () => {
		const original = globalThis.Notification;
		class FakeNotification {
			static permission = "granted" as const;
			onclick: (() => void) | null = null;

			constructor(
				readonly title: string,
				readonly options: { body: string }
			) {}

			close(): void {}
		}
		Object.defineProperty(globalThis, "Notification", {
			configurable: true,
			value: FakeNotification,
		});

		try {
			await expect(
				dispatchRpc(
					"native.notifications.create",
					[{ title: "Ready", body: "Browser proof" }],
					capabilitiesFromGrants(["native:notifications"]),
					baseServices
				)
			).resolves.toMatchObject({ scheduled: true });
		} finally {
			if (original) {
				Object.defineProperty(globalThis, "Notification", {
					configurable: true,
					value: original,
				});
			} else {
				Reflect.deleteProperty(globalThis, "Notification");
			}
		}
	});
});
