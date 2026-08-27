import { describe, expect, it } from "bun:test";
import { createScopedToastHost, type ToastRenderer } from "./toast-host.ts";

function recordingRenderer() {
	const dismissed: string[] = [];
	const rendered: { input: unknown; slotId: string }[] = [];
	const renderer: ToastRenderer = {
		dismiss: (slotId) => dismissed.push(slotId),
		render: (input, slotId) => rendered.push({ input, slotId }),
	};
	return { dismissed, rendered, renderer };
}

describe("scoped toast host", () => {
	it("keeps caller ids opaque and updates only the mapped renderer slot", () => {
		const record = recordingRenderer();
		let random = 0;
		const host = createScopedToastHost({
			renderer: record.renderer,
			sourceId: "@ryu/workflows",
			randomId: () => {
				random += 1;
				return `random-${random}`;
			},
		});
		const id = host.show({ title: "Running", variant: "loading" });
		const slotId = record.rendered[0]?.slotId ?? "";

		expect(id).not.toBe(slotId);
		expect(slotId).toStartWith("ryu-app-toast-");
		host.update({ id, title: "Complete", variant: "success" });
		expect(record.rendered).toEqual([
			{
				input: { title: "Running", variant: "loading" },
				slotId,
			},
			{
				input: { title: "Complete", variant: "success" },
				slotId,
			},
		]);

		host.dismiss({ id: "another-app-id" });
		expect(record.dismissed).toEqual([]);
		host.dismiss({ id });
		expect(record.dismissed).toEqual([slotId]);
	});

	it("rate-limits one source with a structured over_budget error", () => {
		const record = recordingRenderer();
		let now = 0;
		const host = createScopedToastHost({
			maxOperations: 2,
			now: () => now,
			randomId: () => "fixed",
			rateWindowMs: 1000,
			renderer: record.renderer,
			sourceId: "@ryu/teams",
		});
		host.show({ title: "One" });
		host.show({ title: "Two" });
		expect(() => host.show({ title: "Three" })).toThrow(
			expect.objectContaining({ code: "over_budget" })
		);

		now = 1000;
		expect(() => host.show({ title: "After window" })).not.toThrow();
	});

	it("counts unknown update and dismiss ids against the operation budget", () => {
		const record = recordingRenderer();
		const host = createScopedToastHost({
			maxOperations: 2,
			randomId: () => "fixed",
			renderer: record.renderer,
			sourceId: "@ryu/teams",
		});

		host.update({ id: "missing", title: "Ignored" });
		host.dismiss({ id: "missing" });
		expect(() => host.dismiss({ id: "still-missing" })).toThrow(
			expect.objectContaining({ code: "over_budget" })
		);
		expect(record.rendered).toEqual([]);
		expect(record.dismissed).toEqual([]);
	});

	it("bounds active slots and dismisses every remaining toast on dispose", () => {
		const record = recordingRenderer();
		let random = 0;
		const host = createScopedToastHost({
			maxActive: 2,
			randomId: () => {
				random += 1;
				return `random-${random}`;
			},
			renderer: record.renderer,
			sourceId: "@ryu/workflows",
		});
		host.show({ title: "One" });
		host.show({ title: "Two" });
		host.show({ title: "Three" });
		const slots = record.rendered.map((entry) => entry.slotId);
		const firstSlot = slots[0];
		if (!firstSlot) {
			throw new Error("expected the first toast to render");
		}

		expect(record.dismissed).toEqual([firstSlot]);
		host.dispose();
		expect(record.dismissed).toEqual(slots);
	});

	it("namespaces renderer slots across callers", () => {
		const first = recordingRenderer();
		const second = recordingRenderer();
		const firstHost = createScopedToastHost({
			randomId: () => "first-instance",
			renderer: first.renderer,
			sourceId: "@ryu/teams",
		});
		const secondHost = createScopedToastHost({
			randomId: () => "second-instance",
			renderer: second.renderer,
			sourceId: "@ryu/teams",
		});

		firstHost.show({ title: "First" });
		secondHost.show({ title: "Second" });
		expect(first.rendered[0]?.slotId).not.toBe(second.rendered[0]?.slotId);
	});

	it("rejects stale operations after disposal", () => {
		const record = recordingRenderer();
		const host = createScopedToastHost({
			randomId: () => "fixed",
			renderer: record.renderer,
			sourceId: "@ryu/teams",
		});
		host.dispose();

		expect(() => host.show({ title: "Too late" })).toThrow(
			expect.objectContaining({ code: "server_error" })
		);
		expect(record.rendered).toEqual([]);
	});
});
