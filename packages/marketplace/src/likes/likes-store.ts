// packages/marketplace/src/likes/likes-store.ts
//
// The like state every store surface shares, as a plain external store so the
// interesting behaviour — optimistic toggle, rollback, rapid double-click, bulk
// batching — is testable without mounting React.
//
// THREE LAYERS, and the distinction between them is the whole design:
//
//   server   what the control plane last told us. The ONLY thing a failure
//            rolls back to. Rolling back to "whatever it was before this click"
//            is what leaves a phantom count when two clicks race.
//   desired  what the user has asked for and we have not yet confirmed. Set
//            synchronously on click, so the heart fills in the same frame.
//   inflight one request at a time per namespace. A second click does not fire a
//            second parallel request; it rewrites `desired`, and the running
//            worker loops until the server agrees with it.
//
// Counts are never accumulated client-side beyond a ±1 nudge off the last
// server value: every write response carries the authoritative total, and that
// total replaces the local one. So a divergence lasts one request, not forever.

/** One item's like state, exactly as the control plane returns it. */
export interface LikeSnapshot {
	count: number;
	liked: boolean;
	namespace: string;
}

/** What the surface must provide to read and write likes. */
export interface LikesTransport {
	/** BULK read. Called with a whole batch of namespaces, never one at a time. */
	fetchCounts: (namespaces: string[]) => Promise<LikeSnapshot[]>;
	like: (namespace: string) => Promise<LikeSnapshot>;
	unlike: (namespace: string) => Promise<LikeSnapshot>;
}

/**
 * The likes service a SURFACE injects through {@link MarketplaceHost}. The calls
 * live on the CONTROL PLANE (api.ryuhq.com), not on the Core node the catalog is
 * browsed from, so the shared components must not know either address — the same
 * reason `MarketplaceReviewsService` is injected.
 *
 * Omitted by a surface with no control-plane binding at all (the storyboard and
 * test harnesses), which hides the control entirely rather than rendering a
 * heart that can never resolve a count.
 */
export interface MarketplaceLikesService extends LikesTransport {
	/** Whether a like WRITE can be attempted — i.e. a signed-in session exists.
	 *  Read as a function, not a boolean, because the session can appear without
	 *  the host object identity changing. */
	canLike: () => boolean;
	/** What to do when a signed-out visitor clicks the heart. Supplied by the
	 *  surface because "prompt sign-in" means a route on web and a toast with an
	 *  action on desktop. Omitted ⇒ the click is a no-op. */
	onRequireAuth?: () => void;
}

/** The state one card renders. */
export interface LikeView {
	count: number;
	liked: boolean;
	/** True while this namespace's like state has not yet been read from the
	 *  server AND was not seeded from a list response. Lets a card render a
	 *  neutral heart rather than a confident "0". */
	loading: boolean;
}

const EMPTY_VIEW: LikeView = { count: 0, liked: false, loading: true };

/** How long to wait for sibling cards to register before firing the bulk read.
 *  One animation frame's worth: long enough that a 60-card grid mounting in one
 *  commit produces ONE request, short enough to be invisible. */
export const LIKE_BATCH_WINDOW_MS = 16;

/** Cap on one bulk request, mirroring the server's own cap. A grid larger than
 *  this is split into several requests rather than silently truncated. */
export const LIKE_BATCH_MAX = 200;

export class LikesStore {
	private readonly transport: LikesTransport;
	/** Called when a WRITE failed and was rolled back, so the surface can say so.
	 *  Reads never call it — a decoration that could not load must stay silent. */
	private readonly onWriteError: (namespace: string) => void;
	/** Last server truth per namespace. */
	private readonly server = new Map<
		string,
		{ count: number; liked: boolean }
	>();
	/** Unconfirmed user intent per namespace. */
	private readonly desired = new Map<string, boolean>();
	/** Namespaces with a write worker running. */
	private readonly inflight = new Set<string>();
	/** Namespaces registered by a card but not yet read. */
	private readonly unresolved = new Set<string>();
	/** Namespaces already requested (so a re-render does not re-request). */
	private readonly requested = new Set<string>();
	/** Memoized per-namespace view objects — `useSyncExternalStore` requires a
	 *  snapshot that is referentially stable while nothing changed. */
	private readonly views = new Map<string, LikeView>();
	private readonly listeners = new Set<() => void>();
	private flushTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		transport: LikesTransport,
		onWriteError: (namespace: string) => void = () => {
			// no-op
		}
	) {
		this.transport = transport;
		this.onWriteError = onWriteError;
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	private emit(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}

	/** Recompute (and cache) the view for one namespace, notifying if it moved. */
	private refresh(namespace: string): void {
		const server = this.server.get(namespace);
		const desired = this.desired.get(namespace);
		const liked = desired ?? server?.liked ?? false;
		const base = server?.count ?? 0;
		// The optimistic nudge: the server count, plus or minus one only when the
		// displayed state differs from the server's. Never a running tally.
		const delta = (liked ? 1 : 0) - (server?.liked ? 1 : 0);
		const next: LikeView = {
			count: Math.max(0, base + delta),
			liked,
			loading: !server && desired === undefined,
		};
		const prev = this.views.get(namespace);
		if (
			prev &&
			prev.count === next.count &&
			prev.liked === next.liked &&
			prev.loading === next.loading
		) {
			return;
		}
		this.views.set(namespace, next);
		this.emit();
	}

	/** The stable snapshot a card renders. */
	getView = (namespace: string): LikeView =>
		this.views.get(namespace) ?? EMPTY_VIEW;

	/**
	 * Seed a namespace from a LIST response that already carried its count. This
	 * is why a grid does not flash: the cards paint the right number on the first
	 * frame instead of counting up once a request lands.
	 *
	 * `liked` is THREE-valued and the distinction matters:
	 *   true/false  the response carried the CALLER's own state (an authenticated
	 *               `/catalog` read). Fully resolved — no request is scheduled,
	 *               so the heart never flips from unliked to liked on load.
	 *   null        the count is known but whose likes it counts is not (a
	 *               cookie-less server render, cached for every visitor alike).
	 *               The count is seeded, and a read is STILL scheduled to resolve
	 *               the caller's own flag. Seeding `false` here instead would
	 *               permanently show a signed-in visitor an unliked heart on an
	 *               item they had liked.
	 *
	 * A seed never overwrites a value we have already resolved or a pending
	 * intent — a stale page payload must not undo a like the user just made.
	 */
	seed(namespace: string, count: number, liked: boolean | null = null): void {
		if (this.desired.has(namespace) || this.requested.has(namespace)) {
			return;
		}
		const existing = this.server.get(namespace);
		this.server.set(namespace, {
			count: Math.max(0, count),
			liked: liked ?? existing?.liked ?? false,
		});
		if (liked !== null) {
			this.requested.add(namespace);
			this.unresolved.delete(namespace);
		}
		this.refresh(namespace);
	}

	/** Register a namespace that needs reading. Coalesced into one bulk request
	 *  with every other namespace registered in the same window. */
	register(namespace: string): void {
		if (this.requested.has(namespace)) {
			this.refresh(namespace);
			return;
		}
		this.unresolved.add(namespace);
		this.refresh(namespace);
		this.scheduleFlush();
	}

	private scheduleFlush(): void {
		if (this.flushTimer !== null) {
			return;
		}
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			void this.flush();
		}, LIKE_BATCH_WINDOW_MS);
	}

	/** Issue the batched bulk read. Public for tests and for a manual refresh. */
	async flush(): Promise<void> {
		const batch = [...this.unresolved].slice(0, LIKE_BATCH_MAX);
		if (batch.length === 0) {
			return;
		}
		for (const namespace of batch) {
			this.unresolved.delete(namespace);
			this.requested.add(namespace);
		}
		if (this.unresolved.size > 0) {
			// More than one batch worth registered at once — keep draining.
			this.scheduleFlush();
		}
		let snapshots: LikeSnapshot[];
		try {
			snapshots = await this.transport.fetchCounts(batch);
		} catch {
			// A failed read leaves the cards at zero rather than blanking them, and
			// re-arms the namespaces so a later mount can retry. A like control is a
			// decoration; it must never surface an error toast for a read.
			for (const namespace of batch) {
				this.requested.delete(namespace);
				this.server.set(
					namespace,
					this.server.get(namespace) ?? {
						count: 0,
						liked: false,
					}
				);
				this.refresh(namespace);
			}
			return;
		}
		const seen = new Set<string>();
		for (const snapshot of snapshots) {
			seen.add(snapshot.namespace);
			this.server.set(snapshot.namespace, {
				count: Math.max(0, snapshot.count),
				liked: snapshot.liked,
			});
			this.refresh(snapshot.namespace);
		}
		// A namespace the server did not mention has no likes yet — record the
		// zero so the card stops reading as "loading".
		for (const namespace of batch) {
			if (!seen.has(namespace)) {
				this.server.set(namespace, { count: 0, liked: false });
				this.refresh(namespace);
			}
		}
	}

	/**
	 * Toggle a namespace. Returns immediately — the heart is already filled by
	 * the time this resolves its first await.
	 */
	toggle(namespace: string): void {
		const current = this.getView(namespace);
		this.desired.set(namespace, !current.liked);
		this.refresh(namespace);
		void this.run(namespace);
	}

	/**
	 * The single-flight write worker. Loops rather than firing per click, so a
	 * rapid double-click issues at most one request at a time and settles on the
	 * user's LAST intent — never two racing requests whose responses can land out
	 * of order and leave the count one off.
	 */
	private async run(namespace: string): Promise<void> {
		if (this.inflight.has(namespace)) {
			return;
		}
		this.inflight.add(namespace);
		try {
			// Yield ONE microtask before reading the intent. Two clicks in the same
			// frame both land first, so a double-click that cancels itself sends
			// nothing at all rather than a like followed by a corrective unlike.
			// The VIEW has already moved — `toggle` refreshed synchronously — so
			// this costs no perceived latency.
			await Promise.resolve();
			for (;;) {
				const desired = this.desired.get(namespace);
				if (desired === undefined) {
					return;
				}
				const server = this.server.get(namespace);
				if (server && desired === server.liked) {
					// The user toggled back to where the server already is. Nothing to
					// send; drop the intent and render server truth.
					this.desired.delete(namespace);
					this.refresh(namespace);
					return;
				}
				const snapshot = desired
					? await this.transport.like(namespace)
					: await this.transport.unlike(namespace);
				this.server.set(namespace, {
					count: Math.max(0, snapshot.count),
					liked: snapshot.liked,
				});
				this.requested.add(namespace);
				if (this.desired.get(namespace) === desired) {
					this.desired.delete(namespace);
				}
				this.refresh(namespace);
			}
		} catch {
			// ROLLBACK. Drop the intent entirely and fall back to the last SERVER
			// truth, not to the pre-click optimistic value: that is what guarantees
			// no phantom count survives, however many clicks raced.
			this.desired.delete(namespace);
			this.refresh(namespace);
			this.onWriteError(namespace);
		} finally {
			this.inflight.delete(namespace);
		}
	}

	/** Test seam: is a write currently in flight for this namespace? */
	isWriting(namespace: string): boolean {
		return this.inflight.has(namespace);
	}

	/** Cancel any pending batch timer (unmount). */
	dispose(): void {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		this.listeners.clear();
	}
}

/**
 * Per-particle vectors for one burst. Eight dots, each with its own angle,
 * distance, size, duration, delay and end scale, so no two likes look alike —
 * a fixed set reads as a mechanism, a jittered one reads as a spray.
 *
 * Pure and injectable-random so a test can assert the shape without flake.
 */
export function burstParticles(random: () => number = Math.random): {
	pdelay: string;
	pdur: string;
	pEndScale: string;
	psize: string;
	px: string;
	py: string;
}[] {
	const count = 8;
	// A random starting angle so the eight dots are not always in the same
	// rotational position, plus per-dot jitter so they are not evenly spaced.
	const base = random() * Math.PI * 2;
	return Array.from({ length: count }, (_, i) => {
		const angle = base + (i / count) * Math.PI * 2 + (random() - 0.5) * 0.7;
		const distance = 14 + random() * 16;
		return {
			px: `${(Math.cos(angle) * distance).toFixed(1)}px`,
			py: `${(Math.sin(angle) * distance).toFixed(1)}px`,
			pdur: `${Math.round(420 + random() * 320)}ms`,
			pdelay: `${Math.round(random() * 90)}ms`,
			pEndScale: (0.3 + random() * 0.5).toFixed(2),
			psize: (0.7 + random() * 1.1).toFixed(2),
		};
	});
}

/** The longest a burst can run: the slowest duration plus the longest delay.
 *  `.is-bursting` must be removed after this, or a second like cannot re-fire
 *  the animation (the class never changed, so nothing restarts). */
export const BURST_MAX_MS = 740 + 90;
