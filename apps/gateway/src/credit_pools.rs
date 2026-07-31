//! Credit-pool attribution: which SEGREGATED supply of donated inference credit
//! a metered request bills against.
//!
//! **This table is a MIRROR, not a source of truth.** The catalog lives in
//! `packages/auth/src/lib/credit-pools.ts` (`CREDIT_POOLS[*].gatewayProviders`),
//! beside the plan catalog, because "what a granted dollar may be spent on" is a
//! control-plane decision. The gateway keeps a copy only because it must tag a
//! debit at the moment the response is served, with no round-trip. The two must
//! be edited together.
//!
//! WHY POOLS EXIST (the invariant this file serves): Ryu runs on donated provider
//! credit — allowances at AWS Bedrock, Cloudflare Workers AI, Google Cloud Vertex
//! AI and OpenAI, each with its own ceiling and its own donor accounting. A
//! dollar of Cloudflare buys roughly 10–20× the tokens a dollar of Bedrock does.
//! So a grant carries a pool, a debit carries a pool, and grant money for a
//! DIFFERENT pool is unreachable — otherwise a $50 Bedrock grant would be
//! spendable on Cloudflare traffic, silently converting scarce expensive supply
//! into cheap supply (and vice versa, which is worse).
//!
//! TWO ROWS ARE NOT NAMED AFTER THEIR VENDOR, and that is deliberate: donated
//! OpenAI supply is `openai-credits`, not `openai`, because `openai` is already
//! the BYOK pass-through slot. Same story for `vertex` vs `genai`. Merging either
//! pair would make a caller's own-key traffic debit the donation.
//!
//! The strings below are DURABLE DATABASE VALUES, not internal identifiers: they
//! are written into `CreditGrant.pool` / `CreditLedger.pool` rows and they travel
//! to and from the control plane verbatim as JSON map KEYS (serde's
//! `rename_all = "camelCase"` renames struct fields, NOT map keys). Renaming one
//! is a data migration, not an edit here.
//!
//! A near-miss provider string fails SILENTLY in the money-losing direction:
//! [`pool_for_gateway_provider`] returns `None`, the request draws no grant, and
//! it never appears in per-pool burn. `pool_ids_all_resolve_in_the_registry`
//! below is what turns that into a compile-time-ish failure instead.

/// Gateway registry id → pool id. The left column is exactly what
/// `Provider::name()` returns in [`crate::providers`]; the right column is a
/// `CreditPoolId` from `credit-pools.ts`.
///
/// A provider id may belong to at most one pool — two pools claiming the same
/// provider would make burn-down attribution ambiguous, and the ambiguity would
/// only ever surface as money in the wrong bucket. `no_provider_is_claimed_twice`
/// asserts it.
const POOL_BY_GATEWAY_PROVIDER: &[(&str, &str)] = &[
    // Cloudflare Workers AI — the cheap open-model supply ("Ryu Fast"). Free-tier,
    // business-card and referral grants land here.
    (crate::config::CLOUDFLARE_PROVIDER_ID, "cloudflare"),
    // AWS Bedrock — the expensive frontier supply ("Ryu Frontier"). The
    // seat-limited campaign ladder grants against this pool and nothing else.
    (crate::config::BEDROCK_PROVIDER_ID, "bedrock"),
    // OpenRouter pass-through — no donated allowance behind it, so it is present
    // purely so retail traffic is still ATTRIBUTABLE in burn dashboards. We never
    // advertise grants against supply we buy at retail, but a debit that carries
    // this tag still costs nothing extra: with no `openrouter` grant on the
    // wallet, the spend falls through to the subscription/top-up buckets exactly
    // as it did before pools existed.
    ("openrouter", "openrouter"),
    // Google Cloud Vertex AI — donated frontier multimodal supply ("Ryu Vision").
    // Distinct from `genai`, which is the AI Studio / Gemini API surface an
    // operator points at their OWN key. Same model family, different endpoint,
    // different account to burn down — so `genai` stays UNTAGGED and only the
    // `vertex` slot draws this grant.
    (crate::config::VERTEX_PROVIDER_ID, "vertex"),
    // OpenAI — donated frontier reasoning supply ("Ryu Reasoning"). READ THE
    // LEFT COLUMN: it is `openai-credits`, NOT `openai`, and the difference is
    // the whole point. `openai` is the BYOK / pass-through slot serving whatever
    // key the node operator configured; tagging it would make every one of those
    // requests debit this donation for spend it never funded. The two are
    // separate registry ids precisely so this table can tell them apart —
    // `byok_openai_is_never_attributed_to_the_donated_pool` pins it.
    (crate::config::OPENAI_CREDITS_PROVIDER_ID, "openai-credits"),
];

/// The pool a metered request bills against, from the registry id of the provider
/// that ACTUALLY served it (`provider.name()` at the debit sites).
///
/// `None` means "not pool-attributed", and it is the correct default for every
/// provider an operator has not tagged: the debit then behaves exactly as it did
/// before pools existed — no grant is reachable and the spend falls through to
/// the subscription and top-up buckets. That is why adding a pool can never
/// retroactively change how existing traffic is billed.
///
/// Linear scan over a handful of rows on purpose: a `HashMap` behind a `OnceLock`
/// would be slower for this size and would trade a `const` for lazy init.
pub fn pool_for_gateway_provider(provider_name: &str) -> Option<&'static str> {
    POOL_BY_GATEWAY_PROVIDER
        .iter()
        .find(|(provider, _)| *provider == provider_name)
        .map(|(_, pool)| *pool)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_provider_is_claimed_twice() {
        // Two pools claiming one provider makes attribution ambiguous, and the
        // ambiguity only ever shows up as money in the wrong donor account.
        for (index, (provider, _)) in POOL_BY_GATEWAY_PROVIDER.iter().enumerate() {
            let duplicate = POOL_BY_GATEWAY_PROVIDER
                .iter()
                .skip(index + 1)
                .any(|(other, _)| other == provider);
            assert!(!duplicate, "gateway provider '{provider}' claimed twice");
        }
    }

    #[test]
    fn untagged_providers_are_not_pool_attributed() {
        // The pre-pools billing path, preserved: `openai`/`anthropic`/`local`
        // traffic draws no grant and is attributed to no pool.
        assert_eq!(pool_for_gateway_provider("openai"), None);
        assert_eq!(pool_for_gateway_provider("anthropic"), None);
        assert_eq!(pool_for_gateway_provider("local"), None);
        assert_eq!(pool_for_gateway_provider(""), None);
    }

    #[test]
    fn byok_openai_is_never_attributed_to_the_donated_pool() {
        // `untagged_providers_are_not_pool_attributed` covers the same `openai`
        // string, but for a weaker reason (nobody has tagged it yet). Since the
        // donated OpenAI allowance landed, that assertion carries real money:
        // `openai` is the slot serving callers' OWN keys, so tagging it would
        // start debiting the donation for spend the donor never funded. Only the
        // separate `openai-credits` slot draws it, and the two must never merge.
        assert_eq!(pool_for_gateway_provider("openai"), None);
        assert_eq!(
            pool_for_gateway_provider("openai-credits"),
            Some("openai-credits")
        );
        // The same shape one level over: `genai` is the own-key Gemini surface,
        // `vertex` is the donated one. Same models, different account.
        assert_eq!(pool_for_gateway_provider("genai"), None);
        assert_eq!(pool_for_gateway_provider("vertex"), Some("vertex"));
    }

    #[test]
    fn pooled_providers_resolve_to_their_pool() {
        assert_eq!(pool_for_gateway_provider("cloudflare"), Some("cloudflare"));
        assert_eq!(pool_for_gateway_provider("bedrock"), Some("bedrock"));
        assert_eq!(pool_for_gateway_provider("openrouter"), Some("openrouter"));
        assert_eq!(pool_for_gateway_provider("vertex"), Some("vertex"));
        assert_eq!(
            pool_for_gateway_provider("openai-credits"),
            Some("openai-credits")
        );
    }

    #[test]
    fn pool_ids_all_resolve_in_the_registry() {
        // The failure mode this guards: a tagged provider that no longer
        // registers stops drawing grant money SILENTLY instead of erroring.
        //
        // Scope it honestly. Every row but `openrouter` is const-backed
        // (`config::{CLOUDFLARE,BEDROCK,VERTEX,OPENAI_CREDITS}_PROVIDER_ID`), so a
        // typo there is already a compile error and this test adds nothing for
        // them. What it actually catches is (a) the bare `"openrouter"` literal
        // and (b) any id's registry SLOT being deleted or renamed out from under
        // the table — which the consts cannot catch, because they would still
        // agree with each other.
        let config: crate::config::ProvidersConfig = serde_json::from_value(serde_json::json!({
            "openai": { "api_key": "sk-o" },
            "anthropic": { "api_key": "sk-a" },
            "local": { "base_url": "http://127.0.0.1:1234" },
            "openrouter": { "api_key": "sk-or" },
            "core": { "base_url": "http://127.0.0.1:7979", "token": "t" },
            "modal": { "api_key": "sk-m", "base_url": "https://modal.example" },
            "genai": { "keys": { "gemini": "sk-g" } },
            "replicate": { "api_key": "sk-r" },
            "fal": { "api_key": "sk-f" },
            "classify": { "base_url": "http://127.0.0.1:8083/v1" },
            "cloudflare": { "api_key": "cf", "base_url": "https://cf.example/ai/v1" },
            "bedrock": { "api_key": "aws", "base_url": "https://bedrock.example/anthropic" },
            "vertex": { "api_key": "gcp", "base_url": "https://vertex.example/endpoints/openapi" },
            "openai_credits": { "api_key": "sk-donated" }
        }))
        .expect("full providers config parses");
        let registry = crate::providers::ProviderRegistry::new(
            &config,
            std::sync::Arc::new(crate::quota::ProviderQuotas::default()),
        );
        for (provider, pool) in POOL_BY_GATEWAY_PROVIDER {
            assert!(
                registry.get(provider).is_some(),
                "credit pool '{pool}' bills gateway provider '{provider}', which no longer registers"
            );
        }
    }
}
