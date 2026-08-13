import type { PlanId } from "./plans.ts";

/**
 * WHICH PLANS INCLUDE THE FREE BASE CLOUD NODE — the single source of truth.
 *
 * The free base node (the `cx23` BASE cloud tier: 2 vCPU · 4 GB · 40 GB) ships
 * with every RECURRING subscription: Pro, Max and Teams. It is NOT included with
 * the one-time `desktop-license` (Lifetime), which grants no managed inference,
 * no credit pool and no cloud node, and obviously not with the free baseline.
 * There is no separate Polar product for it — holding a qualifying subscription
 * is what grants it; any larger instance is an ad-hoc paid cloud-instance
 * subscription on top.
 *
 * This replaces the old `MAX_INCLUDES_BASE_CLOUD` boolean in `plans.ts`, which
 * was never referenced by anything: the entitlement gate in the servers router
 * and the auto-provision gate in the Polar webhook each hardcoded the literal
 * `"max"` independently, so the two could (and did) drift silently — a customer
 * is the only one who ever sees "the webhook provisioned a node the dashboard
 * refuses to re-create". Both now route through {@link planIncludesBaseNode},
 * and every user-visible string names the tiers through
 * {@link BASE_NODE_PLANS_LABEL} rather than spelling out one plan.
 *
 * DELIBERATELY A SIBLING MODULE, not part of `plans.ts`. The public pricing page
 * and the org dashboard are `"use client"` React trees; importing `plans.ts`
 * from them would ship the whole control-plane catalog (every Polar product id
 * and env-var name) to the browser to read one predicate. The only import here
 * is a TYPE, which is erased at compile time — keep it that way.
 */
export const PLANS_INCLUDING_BASE_NODE: readonly PlanId[] = [
	"pro",
	"max",
	"teams",
];

/**
 * Whether a resolved plan grants the free base cloud node. A null plan (the
 * un-entitled free baseline) never does. Single predicate for BOTH gates — the
 * manual provision gate (`assertEntitledForInstance`) and the auto-provision
 * gate in the Polar webhook — so a tier can never be entitled on one path and
 * refused on the other.
 */
export const planIncludesBaseNode = (
	plan: PlanId | null | undefined
): boolean => Boolean(plan && PLANS_INCLUDING_BASE_NODE.includes(plan));

/**
 * How the qualifying plans are NAMED in customer-facing copy ("…is included
 * with Pro, Max or Teams"). Presentational only — never parse it. Every string
 * that used to hardcode "Max" reads this, so widening or narrowing the set is
 * one edit here plus {@link PLANS_INCLUDING_BASE_NODE}, not a nine-file sed.
 */
export const BASE_NODE_PLANS_LABEL = "Pro, Max or Teams";

/**
 * The same set in a conjunctive sentence position ("included with Pro, Max and
 * Teams"). Two constants rather than one because English needs both and a
 * caller that picks the wrong one reads as a typo to a customer.
 */
export const BASE_NODE_PLANS_LABEL_ALL = "Pro, Max and Teams";
