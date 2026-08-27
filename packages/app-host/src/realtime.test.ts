import { afterEach, describe, expect, test } from "bun:test";
import {
	openRealtimeResource,
	type RealtimeAppConnectHandlers,
	type RyuCompanionWindowApi,
} from "./realtime.ts";

const runtime = globalThis as unknown as {
	window?: { ryu?: RyuCompanionWindowApi };
};
const originalWindow = runtime.window;

afterEach(() => {
	runtime.window = originalWindow;
});

describe("openRealtimeResource", () => {
	test("suppresses only its own echo and refetches on lag", async () => {
		let handlers: RealtimeAppConnectHandlers = {};
		const published: Array<{ data: unknown; name: string }> = [];
		let closed = false;
		const realtime = {
			connect: async (
				_input: { roomId: string },
				nextHandlers: RealtimeAppConnectHandlers = {}
			) => {
				handlers = nextHandlers;
				return {
					access: "write" as const,
					close: async () => {
						closed = true;
					},
					memberId: "member-local",
					presence: [],
					publish: async (name: string, data: unknown) => {
						published.push({ data, name });
					},
					publishPresence: async () => {},
					roomId: "resource-1",
				};
			},
		};
		runtime.window = {
			ryu: { realtime, tokenTable: realtime },
		};
		const changed: unknown[] = [];
		const channel = await openRealtimeResource({
			onChanged: (data) => {
				changed.push(data);
			},
			roomId: "resource-1",
		});

		handlers.onEvent?.({
			data: { data: "mine", source_member_id: "member-local" },
			name: "resource.changed",
		});
		handlers.onEvent?.({
			data: { data: "theirs", source_member_id: "member-remote" },
			name: "resource.changed",
		});
		handlers.onResyncRequired?.({ reason: "lagged" });

		expect(changed).toEqual(["theirs", undefined]);
		await channel.publishChanged({ revision: 2 });
		expect(published).toEqual([
			{
				data: {
					data: { revision: 2 },
					source_member_id: "member-local",
				},
				name: "resource.changed",
			},
		]);
		await channel.close();
		expect(closed).toBe(true);
	});

	test("fails clearly when the host did not grant realtime", async () => {
		runtime.window = {};
		await expect(
			openRealtimeResource({ onChanged: () => {}, roomId: "resource-1" })
		).rejects.toThrow("realtime bridge is unavailable");
	});
});
