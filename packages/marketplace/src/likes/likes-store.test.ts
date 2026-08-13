import { describe, expect, it } from "bun:test";
import {
	BURST_MAX_MS,
	burstParticles,
	LIKE_BATCH_MAX,
	type LikeSnapshot,
	LikesStore,
	type LikesTransport,
} from "./likes-store.ts";

/**
 * The behaviour a like control lives or dies on: the heart fills instantly, a
 * failed write leaves NO phantom count, and a rapid double-click settles on the
 * user's last intent rather than racing two requests. All of it is in the store,
 * so all of it is testable without a DOM.
 */

/** A transport whose `like`/`unlike` resolve only when the test says so. */
function deferredTransport() {
	const counts = new Map<string, number>();
	const pending: {
		reject: (e: Error) => void;
		resolve: (snapshot: LikeSnapshot) => void;
	}[] = [];
	const calls: { namespace: string; verb: "like" | "unlike" }[] = [];
	const reads: string[][] = [];

	const settleNext = (
		namespace: string,
		verb: "like" | "unlike"
	): Promise<LikeSnapshot> =>
		new Promise<LikeSnapshot>((resolve, reject) => {
			calls.push({ namespace, verb });
			pending.push({ resolve, reject });
		});

	const transport: LikesTransport = {
		fetchCounts: (namespaces) => {
			reads.push(namespaces);
			return Promise.resolve(
				namespaces.map((namespace) => ({
					namespace,
					count: counts.get(namespace) ?? 0,
					liked: false,
				}))
			);
		},
		like: (namespace) => settleNext(namespace, "like"),
		unlike: (namespace) => settleNext(namespace, "unlike"),
	};
	return { calls, counts, pending, reads, transport };
}

/** Let queued microtasks run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("LikesStore optimistic toggle", () => {
	it("fills the heart and moves the count SYNCHRONOUSLY", () => {
		const harness = deferredTransport();
		const store = new LikesStore(harness.transport);
		store.seed("@ryu/crm", 10, false);

		store.toggle("@ryu/crm");

		// No await: the view has already moved. This is the whole requirement —
		// the fill must not wait on a round trip.
		expect(store.getView("@ryu/crm")).toMatchObject({ count: 11, liked: true });
	});

	it("settles on the SERVER's authoritative count, not the client's guess", async () => {
		const harness = deferredTransport();
		const store = new LikesStore(harness.transport);
		store.seed("@ryu/crm", 10, false);

		store.toggle("@ryu/crm");
		await tick();
		// The server says 12 — someone else liked it in the meantime. The optimistic
		// 11 must be replaced, not added to.
		harness.pending[0]?.resolve({
			namespace: "@ryu/crm",
			count: 12,
			liked: true,
		});
		await tick();

		expect(store.getView("@ryu/crm")).toMatchObject({ count: 12, liked: true });
	});

	it("ROLLS BACK to server truth on failure, leaving no phantom count", async () => {
		const harness = deferredTransport();
		const errors: string[] = [];
		const store = new LikesStore(harness.transport, (ns) => errors.push(ns));
		store.seed("@ryu/crm", 10, false);

		store.toggle("@ryu/crm");
		expect(store.getView("@ryu/crm")).toMatchObject({ count: 11, liked: true });

		await tick();
		harness.pending[0]?.reject(new Error("network"));
		await tick();

		expect(store.getView("@ryu/crm")).toMatchObject({
			count: 10,
			liked: false,
		});
		expect(errors).toEqual(["@ryu/crm"]);
	});

	it("does not leave a phantom count when the SECOND of two writes fails", async () => {
		const harness = deferredTransport();
		const store = new LikesStore(harness.transport);
		store.seed("@ryu/crm", 10, false);

		store.toggle("@ryu/crm"); // like
		await tick();
		harness.pending[0]?.resolve({
			namespace: "@ryu/crm",
			count: 11,
			liked: true,
		});
		await tick();
		store.toggle("@ryu/crm"); // unlike
		await tick();
		harness.pending[1]?.reject(new Error("network"));
		await tick();

		// Back to the last CONFIRMED state (liked, 11) — not to the pre-first-click
		// state, and not to an invented 10.
		expect(store.getView("@ryu/crm")).toMatchObject({
			count: 11,
			liked: true,
		});
	});
});

describe("LikesStore rapid double-click", () => {
	it("issues ONE request at a time and settles on the last intent", async () => {
		const harness = deferredTransport();
		const store = new LikesStore(harness.transport);
		store.seed("@ryu/crm", 10, false);

		store.toggle("@ryu/crm"); // like
		await tick(); // the like is now genuinely in flight
		store.toggle("@ryu/crm"); // unlike, while the like is still unresolved

		// Only the first request has been issued — the second click rewrote the
		// intent instead of racing a parallel write.
		expect(harness.calls).toHaveLength(1);
		expect(harness.calls[0]).toEqual({ namespace: "@ryu/crm", verb: "like" });
		// And the UI is already showing the second click's result.
		expect(store.getView("@ryu/crm")).toMatchObject({
			count: 10,
			liked: false,
		});

		harness.pending[0]?.resolve({
			namespace: "@ryu/crm",
			count: 11,
			liked: true,
		});
		await tick();

		// The worker sees the server (liked) still disagrees with the intent
		// (unliked) and issues the correcting write.
		expect(harness.calls).toHaveLength(2);
		expect(harness.calls[1]).toEqual({ namespace: "@ryu/crm", verb: "unlike" });

		harness.pending[1]?.resolve({
			namespace: "@ryu/crm",
			count: 10,
			liked: false,
		});
		await tick();

		expect(store.getView("@ryu/crm")).toMatchObject({
			count: 10,
			liked: false,
		});
		expect(store.isWriting("@ryu/crm")).toBe(false);
	});

	it("sends NOTHING when two clicks in the same frame cancel out", async () => {
		const harness = deferredTransport();
		const store = new LikesStore(harness.transport);
		store.seed("@ryu/crm", 10, false);

		// The accidental double-click. Both land before the worker reads the
		// intent, so the net change is nothing and nothing is sent — not a like
		// followed by a corrective unlike.
		store.toggle("@ryu/crm");
		store.toggle("@ryu/crm");
		await tick();

		expect(harness.calls).toHaveLength(0);
		expect(store.getView("@ryu/crm")).toMatchObject({
			count: 10,
			liked: false,
		});
	});
});

describe("LikesStore batching", () => {
	it("collapses a whole grid of cards into ONE bulk read", async () => {
		const harness = deferredTransport();
		const store = new LikesStore(harness.transport);
		for (let i = 0; i < 60; i += 1) {
			store.register(`owner/repo-${i}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 40));

		expect(harness.reads).toHaveLength(1);
		expect(harness.reads[0]).toHaveLength(60);
	});

	it("never re-requests a namespace a second card registers", async () => {
		const harness = deferredTransport();
		const store = new LikesStore(harness.transport);
		store.register("@ryu/crm");
		await new Promise((resolve) => setTimeout(resolve, 40));
		store.register("@ryu/crm");
		await new Promise((resolve) => setTimeout(resolve, 40));

		expect(harness.reads).toHaveLength(1);
	});

	it("drains a grid larger than one batch instead of truncating it", async () => {
		const harness = deferredTransport();
		const store = new LikesStore(harness.transport);
		for (let i = 0; i < LIKE_BATCH_MAX + 20; i += 1) {
			store.register(`owner/repo-${i}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 80));

		const requested = harness.reads.flat();
		expect(requested).toHaveLength(LIKE_BATCH_MAX + 20);
	});

	it("leaves a read failure silent and re-armed, never an error state", async () => {
		const store = new LikesStore({
			fetchCounts: () => Promise.reject(new Error("offline")),
			like: () => Promise.reject(new Error("offline")),
			unlike: () => Promise.reject(new Error("offline")),
		});
		store.register("@ryu/crm");
		await new Promise((resolve) => setTimeout(resolve, 40));

		expect(store.getView("@ryu/crm")).toMatchObject({
			count: 0,
			liked: false,
			loading: false,
		});
	});
});

describe("LikesStore seeding", () => {
	it("a FULLY seeded card issues no request at all (no unliked→liked flash)", async () => {
		const harness = deferredTransport();
		const store = new LikesStore(harness.transport);
		store.seed("@ryu/crm", 42, true);
		store.register("@ryu/crm");
		await new Promise((resolve) => setTimeout(resolve, 40));

		expect(harness.reads).toHaveLength(0);
		// Correct on the very first read of the view — nothing to flip into.
		expect(store.getView("@ryu/crm")).toMatchObject({
			count: 42,
			liked: true,
			loading: false,
		});
	});

	it("a COUNT-ONLY seed still resolves the caller's own flag", async () => {
		const harness = deferredTransport();
		harness.counts.set("@ryu/crm", 42);
		const store = new LikesStore(harness.transport);
		// The cookie-less server render: the count is known, whose likes it counts
		// is not. Seeding `false` here would strand a signed-in visitor on an
		// unliked heart for an item they had liked.
		store.seed("@ryu/crm", 42, null);
		expect(store.getView("@ryu/crm")).toMatchObject({
			count: 42,
			loading: false,
		});

		store.register("@ryu/crm");
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(harness.reads).toEqual([["@ryu/crm"]]);
	});

	it("a stale seed never undoes a like the user just made", () => {
		const harness = deferredTransport();
		const store = new LikesStore(harness.transport);
		store.seed("@ryu/crm", 10, false);
		store.toggle("@ryu/crm");
		// A re-render hands the old page payload back.
		store.seed("@ryu/crm", 10, false);

		expect(store.getView("@ryu/crm")).toMatchObject({ count: 11, liked: true });
	});
});

describe("burstParticles", () => {
	it("produces exactly the eight dots the stylesheet renders", () => {
		expect(burstParticles(() => 0.5)).toHaveLength(8);
	});

	it("gives every dot its own vector, duration, delay, size and end scale", () => {
		let seed = 0;
		const specs = burstParticles(() => {
			seed += 0.137;
			return seed % 1;
		});
		for (const spec of specs) {
			expect(spec.px).toMatch(/^-?\d+(\.\d+)?px$/);
			expect(spec.py).toMatch(/^-?\d+(\.\d+)?px$/);
			expect(spec.pdur).toMatch(/^\d+ms$/);
			expect(spec.pdelay).toMatch(/^\d+ms$/);
		}
		// An organic spray, not a mechanism: the dots must not share one vector.
		expect(new Set(specs.map((s) => `${s.px}|${s.py}`)).size).toBe(8);
	});

	it("never outruns BURST_MAX_MS, the window .is-bursting is held for", () => {
		// If a particle could still be animating after the class is removed, the
		// burst would visibly cut off. Sample the extremes of the RNG range.
		for (const random of [() => 0, () => 0.999_999]) {
			for (const spec of burstParticles(random)) {
				const total =
					Number.parseInt(spec.pdur, 10) + Number.parseInt(spec.pdelay, 10);
				expect(total).toBeLessThanOrEqual(BURST_MAX_MS);
			}
		}
	});
});
