/**
 * Credit-pool catalog: the single source of truth for the SEGREGATED inference
 * credit pools a grant may be restricted to.
 *
 * CLAUDE.md placement rule (§1): "what is allowed, shared, measured, or paid
 * for" is control-plane, so this sits beside {@link file://./plans.ts} in
 * `@ryu/auth` — plans decide what a subscriber is entitled to, pools decide
 * WHICH SUPPLY a granted dollar may be spent against.
 *
 * WHY POOLS EXIST AT ALL (the invariant everything below serves): Ryu is
 * running on donated provider credit — an $8,000 AWS Bedrock allowance for
 * frontier models, a $10,000 Cloudflare Workers AI allowance for open models,
 * and two further donated allowances (Google Cloud Vertex AI and OpenAI) whose
 * real figures are not in yet, so they carry
 * {@link PLACEHOLDER_POOL_CEILING_MICRO_USD}. A dollar of Cloudflare buys
 * roughly 10–20× the tokens a dollar of
 * Bedrock does, each allowance has its OWN ceiling, and each burns down against
 * its OWN donor accounting. A blended ledger therefore cannot answer the one
 * question that matters operationally — "how much Bedrock is left?" — and a
 * blended WALLET would let a $50 Bedrock grant be spent on Cloudflare traffic,
 * silently converting cheap supply into expensive supply. So a grant carries a
 * pool, a debit carries a pool, and grant money for a different pool is
 * unreachable by construction (see `debitWallet` in `@ryu/api/lib/credits`).
 *
 * USERS NEVER SEE A PROVIDER. The wallet is denominated in one Ryu-native unit
 * ("Ryu Credits"); {@link CreditPool.label} is the only name a user reads, and
 * it names a SPEED/CAPABILITY tier ("Ryu Fast" / "Ryu Frontier"), never a
 * vendor. Swapping the supplier behind a pool must not change what anyone was
 * promised.
 */

/**
 * The pool identifiers. These strings are DURABLE: they are written into
 * `CreditGrant.pool`, `CreditLedger.pool` and `CreditCampaign.pool` rows, and
 * they travel to the gateway verbatim as map KEYS (a `HashMap<String, i64>` of
 * per-pool budgets — serde's `rename_all = "camelCase"` renames struct fields,
 * NOT map keys). Renaming one is a data migration plus a gateway change, not an
 * edit here.
 */
export const CREDIT_POOL_IDS = [
	"cloudflare",
	"bedrock",
	"openrouter",
	"vertex",
	// NOT `openai`: that id is already taken on the gateway side by the
	// operator's OWN-KEY OpenAI provider (`config.openai` in
	// `apps/gateway/src/providers/mod.rs`, which `gpt-` / `o1` / `o3` / `o4` /
	// `text-davinci` route to). Attributing a node's own-key OpenAI traffic to
	// this donated allowance would burn the donation down for spend it never
	// paid for, so the donated supply gets its own registry slot and its own id.
	"openai-credits",
] as const;
export type CreditPoolId = (typeof CREDIT_POOL_IDS)[number];

/**
 * How a pool is positioned in the funnel. `free` is the cheap open-model supply
 * we can afford to give away (reach); `frontier` is the expensive supply we
 * spend to convert; `default` is the residual pass-through with no donated
 * allowance behind it.
 */
export type CreditPoolTier = "free" | "frontier" | "default";

/** One segregated supply of inference credit. */
export interface CreditPool {
	/**
	 * The donated allowance behind this pool, in micro-USD; `0` = uncapped (no
	 * donor ceiling, e.g. pass-through supply we pay for ourselves). This is the
	 * BURN-DOWN denominator for ops dashboards, not a per-user or per-wallet
	 * limit — nothing in the debit path reads it.
	 */
	readonly budgetCeilingMicroUsd: number;
	/** Operator-facing explanation of what supply this pool actually is. */
	readonly description: string;
	/**
	 * The gateway REGISTRY IDS whose traffic this pool bills for — the exact
	 * strings `provider.name()` returns in `apps/gateway/src/providers/mod.rs`.
	 * A near-miss string is silent: {@link poolForGatewayProvider} returns null
	 * and the request is attributed to no pool at all, so it never draws grant
	 * money and never appears in per-pool burn. Verify against the registry when
	 * adding one.
	 */
	readonly gatewayProviders: readonly string[];
	readonly id: CreditPoolId;
	/** The ONLY user-facing name for this pool. Names a tier, never a vendor. */
	readonly label: string;
	readonly tier: CreditPoolTier;
	/**
	 * Whether the pool is offered in user-facing pickers / campaign copy. A
	 * hidden pool still meters and still accepts grants — it is simply not
	 * something a user is ever asked to choose or is advertised credit in.
	 */
	readonly visible: boolean;
}

// One micro-USD is a millionth of a dollar; the unit the credit wallet stores.
// Duplicated from plans.ts's `usdToMicro` rather than imported, so this catalog
// stays a leaf module (it is imported by the gateway-facing resolve path, which
// must not drag in the Polar plan catalog).
const MICRO_USD_PER_USD = 1_000_000;
const usd = (dollars: number): number =>
	Math.round(dollars * MICRO_USD_PER_USD);

/**
 * PLACEHOLDER — NOT THE REAL DONATED FIGURE. The Vertex and OpenAI allowances
 * were granted before anyone wrote down how large they are, and a ceiling is the
 * only brake on a donated pool (`reservePoolBudget` refuses a grant that would
 * cross it), so the two rows below are seeded deliberately LOW rather than
 * guessed high. `0` would mean UNCAPPED, which is the one value that must never
 * be the guess.
 *
 * WHO FIXES IT, AND HOW: not by editing this line. `seedPoolBudgets`
 * (`@ryu/api/lib/campaigns`) writes `ceilingMicroUsd` with `$setOnInsert`,
 * because the STORED ROW is the authority and this catalog is only its default —
 * so on any database that has already seeded, raising this constant and
 * redeploying changes NOTHING. The real figure goes in with one operator write
 * to the `CreditPoolBudget` row, no deploy needed. Leave this at its
 * conservative value; it exists to bound a fresh install, not to be tuned.
 */
const PLACEHOLDER_POOL_CEILING_MICRO_USD = usd(1000);

/**
 * The pool catalog. Ceilings are the DONATED allowances as granted; they are
 * documented here so the burn-down number has a denominator in one place — with
 * the two {@link PLACEHOLDER_POOL_CEILING_MICRO_USD} rows as the exception that
 * says so out loud.
 */
export const CREDIT_POOLS: Record<CreditPoolId, CreditPool> = {
	cloudflare: {
		id: "cloudflare",
		label: "Ryu Fast",
		description:
			"Cloudflare Workers AI — open models (Llama, Mistral, …). Roughly 10–20× cheaper per token than the frontier pool, which is what makes it affordable to hand out for free: business-card and referral grants land here.",
		gatewayProviders: ["cloudflare"],
		budgetCeilingMicroUsd: usd(10_000),
		tier: "free",
		visible: true,
	},
	bedrock: {
		id: "bedrock",
		label: "Ryu Frontier",
		description:
			"AWS Bedrock — frontier models (Claude, …). The expensive, scarce supply spent deliberately on conversion: the seat-limited campaign ladder (Founding / Early / Launch) grants against this pool and nothing else.",
		gatewayProviders: ["bedrock"],
		budgetCeilingMicroUsd: usd(8000),
		tier: "frontier",
		visible: true,
	},
	openrouter: {
		id: "openrouter",
		label: "Ryu",
		description:
			"OpenRouter pass-through — no donated allowance behind it, so it is uncapped here and paid for out of ordinary top-up/subscription credit. Present so OpenRouter traffic is still ATTRIBUTABLE to a pool in burn dashboards; hidden because we never advertise grants against supply we buy at retail.",
		gatewayProviders: ["openrouter"],
		budgetCeilingMicroUsd: 0,
		tier: "default",
		visible: false,
	},
	vertex: {
		id: "vertex",
		label: "Ryu Vision",
		description:
			"Google Cloud Vertex AI — donated allowance for frontier multimodal models (Gemini, …). A SEPARATE gateway slot from `genai`, which is the AI Studio / Gemini API surface an operator points at their OWN key: same model family, different endpoint, different auth, and — the part that matters here — a different account to burn down.",
		gatewayProviders: ["vertex"],
		budgetCeilingMicroUsd: PLACEHOLDER_POOL_CEILING_MICRO_USD,
		tier: "frontier",
		visible: true,
	},
	"openai-credits": {
		id: "openai-credits",
		label: "Ryu Reasoning",
		description:
			"OpenAI API — donated allowance for frontier reasoning models. Deliberately NOT the `openai` gateway id: that slot serves whatever key the node operator configured, so pooling it would burn this donation down for spend it never funded.",
		gatewayProviders: ["openai-credits"],
		budgetCeilingMicroUsd: PLACEHOLDER_POOL_CEILING_MICRO_USD,
		tier: "frontier",
		visible: true,
	},
};

/** The catalog as a list, in {@link CREDIT_POOL_IDS} order. */
export const ALL_CREDIT_POOLS: readonly CreditPool[] = CREDIT_POOL_IDS.map(
	(id) => CREDIT_POOLS[id]
);

/**
 * Reverse index gateway registry id → pool, built ONCE at module load. The
 * debit path calls {@link poolForGatewayProvider} on every metered request, so
 * this must never be an O(pools × providers) scan per call.
 *
 * A provider id may belong to at most one pool — two pools claiming the same
 * provider would make attribution (and therefore burn-down) ambiguous, and the
 * ambiguity would only surface as money in the wrong bucket. We fail LOUDLY at
 * import time instead.
 */
const POOL_BY_GATEWAY_PROVIDER: ReadonlyMap<string, CreditPoolId> = (() => {
	const index = new Map<string, CreditPoolId>();
	for (const pool of ALL_CREDIT_POOLS) {
		for (const provider of pool.gatewayProviders) {
			const claimed = index.get(provider);
			if (claimed) {
				throw new Error(
					`credit pool "${pool.id}" claims gateway provider "${provider}" already claimed by "${claimed}"`
				);
			}
			index.set(provider, pool.id);
		}
	}
	return index;
})();

/**
 * The pool a gateway request bills against, from the provider that actually
 * served it (`provider.name()` at the gateway debit sites). `null` means "this
 * provider is not pool-attributed" — the debit then behaves exactly as it did
 * before pools existed: no grant is reachable, and the spend falls through to
 * the subscription and top-up buckets. That is the correct default for every
 * provider an operator has not tagged, and it is why adding a pool can never
 * retroactively change how existing traffic is billed.
 */
export const poolForGatewayProvider = (
	providerName: string
): CreditPoolId | null => POOL_BY_GATEWAY_PROVIDER.get(providerName) ?? null;

/**
 * Runtime guard for pool ids arriving over the wire (the internal debit
 * endpoint, campaign admin input, a gateway-supplied tag). Never trust a
 * request body to carry a valid pool: an unrecognized string that reached
 * `CreditGrant.pool` would create money no debit can ever spend.
 */
export const isCreditPoolId = (value: string): value is CreditPoolId =>
	Object.hasOwn(CREDIT_POOLS, value);
