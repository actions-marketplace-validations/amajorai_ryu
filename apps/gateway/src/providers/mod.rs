//! Provider wiring: the `ProviderRegistry` + config-driven registration + key
//! custody. The concrete provider implementations, the `Provider` trait, the
//! shared provider HTTP helpers, the quota sink, and the video-job value types
//! live in the `ryu-gw-providers` crate (decomposition W6). This module keeps
//! only the "wiring" — the registry that reads `ProvidersConfig`, holds the
//! provider keys, and constructs each built-in — so a new provider is a drop-in
//! (register a new id) with no enum/struct edit. Re-exported here so existing
//! `crate::providers::{Provider, ProviderRegistry}` paths are byte-unchanged.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use crate::config::{
    BEDROCK_PROVIDER_ID, CLOUDFLARE_PROVIDER_ID, OPENAI_CREDITS_PROVIDER_ID, ProvidersConfig,
    VERTEX_PROVIDER_ID,
};
use crate::quota::ProviderQuotas;

pub use ryu_gw_providers::{
    AnthropicProvider, CoreProvider, FalProvider, GenAiProvider, LocalProvider, ModalProvider,
    OpenAiProvider, OpenRouterOptions, OpenRouterProvider, Provider, ReplicateProvider,
};

/// A provider re-exposed under a registry id that differs from its own
/// [`Provider::name`].
///
/// Needed because one impl can back two registry slots: the classify tier speaks
/// the same OpenAI-compatible dialect as the resident local engine and so reuses
/// [`LocalProvider`], whose `name()` is the hardcoded `"local"`. Registering that
/// instance by name would *replace* the chat engine outright — and even keyed
/// correctly, the pipeline attributes metrics, admission slots and circuit-breaker
/// state by `provider.name()` (`pipeline/mod.rs`), so a bare alias would book a
/// classify-sidecar failure against `local` and trip the breaker on the user's
/// chat model. Overriding `name()` keeps the two tiers isolated end to end.
///
/// Every other trait method forwards verbatim, including the ones with default
/// bodies: those defaults are phrased in terms of `self.name()`, so forwarding
/// (rather than inheriting) keeps the inner provider's real capabilities and its
/// own error wording intact.
struct AliasedProvider {
    id: &'static str,
    inner: Arc<dyn Provider>,
}

impl Provider for AliasedProvider {
    fn name(&self) -> &'static str {
        self.id
    }

    fn discover_models<'a>(
        &'a self,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Option<Vec<serde_json::Value>>> + Send + 'a>,
    > {
        self.inner.discover_models()
    }

    fn complete<'a>(
        &'a self,
        model: &'a str,
        body: &'a serde_json::Value,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = Result<serde_json::Value, ryu_gw_providers::ProviderError>,
                > + Send
                + 'a,
        >,
    > {
        self.inner.complete(model, body)
    }

    fn complete_stream<'a>(
        &'a self,
        model: &'a str,
        body: &'a serde_json::Value,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = Result<axum::body::Body, ryu_gw_providers::ProviderError>,
                > + Send
                + 'a,
        >,
    > {
        self.inner.complete_stream(model, body)
    }

    fn generate_image<'a>(
        &'a self,
        model: &'a str,
        body: &'a serde_json::Value,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = Result<serde_json::Value, ryu_gw_providers::ProviderError>,
                > + Send
                + 'a,
        >,
    > {
        self.inner.generate_image(model, body)
    }

    fn synthesize_speech<'a>(
        &'a self,
        model: &'a str,
        body: &'a serde_json::Value,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = Result<serde_json::Value, ryu_gw_providers::ProviderError>,
                > + Send
                + 'a,
        >,
    > {
        self.inner.synthesize_speech(model, body)
    }

    fn transcribe_audio<'a>(
        &'a self,
        model: &'a str,
        body: &'a serde_json::Value,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = Result<serde_json::Value, ryu_gw_providers::ProviderError>,
                > + Send
                + 'a,
        >,
    > {
        self.inner.transcribe_audio(model, body)
    }

    fn submit_video<'a>(
        &'a self,
        model: &'a str,
        body: &'a serde_json::Value,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = Result<ryu_gw_providers::VideoJob, ryu_gw_providers::ProviderError>,
                > + Send
                + 'a,
        >,
    > {
        self.inner.submit_video(model, body)
    }

    fn poll_video<'a>(
        &'a self,
        provider_ref: &'a str,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = Result<ryu_gw_providers::VideoJob, ryu_gw_providers::ProviderError>,
                > + Send
                + 'a,
        >,
    > {
        self.inner.poll_video(provider_ref)
    }
}

/// Dynamic, id-keyed provider registry.
///
/// Dispatch is by stable string id (not a closed enum): every provider
/// registers itself under its own [`Provider::name`] and lookups go through the
/// map, so a new provider — including an out-of-process / plugin provider — can
/// be added by registering a new id without touching any closed enum. This is
/// the gateway-side analogue of Core's `RunnableRegistry`.
///
/// The `order` vector preserves deterministic registration/iteration order
/// (`available_providers`, and thus the model-discovery merge precedence in
/// `/v1/models`, are order-sensitive). Construction of a provider that lacks its
/// key is skipped entirely, so its id is simply absent from the map — exactly
/// the old `Option::None` behavior.
pub struct ProviderRegistry {
    providers: HashMap<String, Arc<dyn Provider>>,
    order: Vec<String>,
}

impl ProviderRegistry {
    pub fn new(config: &ProvidersConfig, quota: Arc<ProviderQuotas>) -> Self {
        let client = build_client();
        let mut registry = Self {
            providers: HashMap::new(),
            order: Vec::new(),
        };

        // Register built-ins in the same deterministic order as before so
        // `available_providers()` iteration (and the /v1/models discovery merge
        // that depends on it) is byte-for-byte identical. A provider whose config
        // is absent is not constructed, so its id never enters the map.
        if let Some(c) = config.openai.as_ref() {
            registry.register(Arc::new(OpenAiProvider::new(
                client.clone(),
                c.all_keys(),
                c.base_url.clone(),
                Arc::clone(&quota),
            )));
        }

        if let Some(c) = config.anthropic.as_ref() {
            registry.register(Arc::new(AnthropicProvider::new(
                client.clone(),
                c.all_keys(),
                c.base_url.clone(),
                Arc::clone(&quota),
            )));
        }

        if let Some(c) = config.local.as_ref() {
            registry.register(Arc::new(LocalProvider::new(
                client.clone(),
                c.base_url.clone(),
            )));
        }

        if let Some(c) = config.openrouter.as_ref() {
            let options = OpenRouterOptions {
                data_collection: (!c.data_collection.is_empty()).then(|| c.data_collection.clone()),
                zdr: c.zdr.then_some(true),
                sort: (!c.sort.is_empty()).then(|| c.sort.clone()),
                response_healing: c.response_healing,
                usage_accounting: c.usage_accounting,
            };
            registry.register(Arc::new(OpenRouterProvider::new(
                client.clone(),
                c.all_keys(),
                c.base_url.clone(),
                c.site_url.clone(),
                c.site_name.clone(),
                options,
                Arc::clone(&quota),
            )));
        }

        if let Some(c) = config.core.as_ref() {
            registry.register(Arc::new(CoreProvider::new(
                client.clone(),
                c.base_url.clone(),
                c.token.clone(),
            )));
        }

        if let Some(c) = config.modal.as_ref() {
            registry.register(Arc::new(ModalProvider::new(
                client.clone(),
                c.api_key.clone(),
                c.base_url.clone(),
            )));
        }

        if let Some(c) = config.genai.as_ref() {
            registry.register(Arc::new(GenAiProvider::new(c.keys.clone())));
        }

        if let Some(c) = config.replicate.as_ref() {
            registry.register(Arc::new(ReplicateProvider::new(
                client.clone(),
                c.api_key.clone(),
                c.base_url.clone(),
                c.poll_interval_ms,
                c.poll_timeout_secs,
            )));
        }

        if let Some(c) = config.fal.as_ref() {
            registry.register(Arc::new(FalProvider::new(
                client.clone(),
                c.api_key.clone(),
                c.base_url.clone(),
                c.poll_interval_ms,
                c.poll_timeout_secs,
            )));
        }

        // The classify tier, registered LAST on purpose: `available_providers()`
        // order drives the `/v1/models` discovery merge precedence, so appending
        // leaves every existing provider's precedence byte-identical. It speaks
        // the same OpenAI-compatible dialect as `local`, so it reuses
        // [`LocalProvider`] — aliased to the `"classify"` id so the two tiers
        // never share metrics, admission slots or circuit-breaker state (see
        // [`AliasedProvider`]).
        //
        // GRACEFUL DEGRADE, but read the shape carefully — an earlier version of
        // this comment claimed "on most nodes there is no `RYU_CLASSIFY_LLM_URL`",
        // which is backwards and misled three units:
        //
        // * The sidecar PROCESS is lazy (absent from Core's `startup_order`), but
        //   Core publishes `RYU_CLASSIFY_LLM_URL` UNCONDITIONALLY in
        //   `gateway_spawn_env` — it deliberately does not gate the URL on the
        //   sidecar being installed or running. So on every Core-spawned gateway
        //   this slot is `Some` and `classify` IS registered.
        // * `get("classify") == None` therefore means "standalone gateway with no
        //   published URL" — only there does `firewall/inspector.rs` take the
        //   absent-provider branch and `warn!` naming the provider + model.
        // * On a real node a COLD tier is `Some(slot)` + connection refused, so it
        //   surfaces as `provider.complete` → `ProviderError`, NOT as an absent
        //   provider. That arm used to log the same "provider call failed" line an
        //   upstream 500 does; `firewall/inspector.rs::provider_failure_message` now
        //   branches on this id and says the local tier is not running instead. The
        //   branch lives there because that is where the routed decision is known —
        //   keep the two in sync through `config::CLASSIFY_PROVIDER_ID`, never a
        //   second `"classify"` literal.
        //
        // Either way the guardrail fails open, which is the deliberate posture for
        // something that must never hard-fail a turn. Do not "fix" the absent slot
        // into a startup error.
        if let Some(c) = config.classify.as_ref() {
            registry.register_as(
                crate::config::CLASSIFY_PROVIDER_ID,
                Arc::new(LocalProvider::new(client.clone(), c.base_url.clone())),
            );
        }

        // The SEGREGATED credit-pool supplies (see [`crate::credit_pools`]).
        // Registered AFTER `classify` for the same reason `classify` is last:
        // `available_providers()` order drives the /v1/models discovery-merge
        // precedence, so appending leaves every existing provider's precedence
        // byte-identical. Both are absent-when-unconfigured like every other
        // built-in — an untagged deploy simply lacks the id.
        //
        // KNOWN, DELIBERATE ALIAS DEFECT: `AliasedProvider` overrides `name()`
        // for the pipeline's keying (metrics, admission slots, circuit breaker),
        // but the quota sink is written from a literal INSIDE each impl
        // (`openai.rs` records `"openai"`, `anthropic.rs` records `"anthropic"`).
        // So an aliased Cloudflare 429 books against `openai` and an aliased
        // Bedrock 429 against `anthropic` in `/metrics.provider_quota`. Nothing
        // routes on that snapshot today, so this is observability, not
        // correctness — but "which pool is rate-limited" is exactly the signal a
        // segregated-pool operator will eventually want, and closing it means
        // threading a label parameter through `ryu-gw-providers`.
        if let Some(c) = config.cloudflare.as_ref() {
            // Cloudflare Workers AI exposes an OpenAI-compatible surface at
            // `{account}/ai/v1/chat/completions` with bearer auth — byte-for-byte
            // what `OpenAiProvider` already sends, so it needs no impl.
            registry.register_as(
                CLOUDFLARE_PROVIDER_ID,
                Arc::new(OpenAiProvider::new(
                    client.clone(),
                    c.all_keys(),
                    c.base_url.clone(),
                    Arc::clone(&quota),
                )),
            );
        }

        if let Some(c) = config.bedrock.as_ref() {
            // Bedrock rides ANTHROPIC MESSAGES, not the OpenAI dialect, and this
            // is not a style preference: Bedrock does serve
            // `/v1/chat/completions`, but its per-model compatibility matrix
            // marks Chat Completions unsupported for EVERY Claude model (that
            // surface exists for `openai.gpt-oss-*`). Claude there is
            // Invoke/Converse/Messages only. `AnthropicProvider` already sends
            // `{base}/v1/messages` with `anthropic-version: 2023-06-01` and the
            // model id in the body, which is exactly Bedrock's Messages contract.
            // Do NOT "simplify" both pools onto one OpenAI-compatible alias.
            registry.register_as(
                BEDROCK_PROVIDER_ID,
                Arc::new(AnthropicProvider::new(
                    client.clone(),
                    c.all_keys(),
                    c.base_url.clone(),
                    Arc::clone(&quota),
                )),
            );
        }

        if let Some(c) = config.vertex.as_ref() {
            // Vertex AI serves an OpenAI-compatible Chat Completions surface at
            // `{project/location endpoint}/openapi/chat/completions` with bearer
            // auth, so — unlike Bedrock — it genuinely needs no impl of its own.
            // The base URL stops at `/endpoints/openapi`; `OpenAiProvider`
            // appends `/chat/completions`.
            registry.register_as(
                VERTEX_PROVIDER_ID,
                Arc::new(OpenAiProvider::new(
                    client.clone(),
                    c.all_keys(),
                    c.base_url.clone(),
                    Arc::clone(&quota),
                )),
            );
        }

        if let Some(c) = config.openai_credits.as_ref() {
            // Same impl and the same endpoint as the `openai` slot above — the
            // ONLY thing that differs is whose key it holds, and that is precisely
            // why it must be its own registry id. `AliasedProvider` is what keeps
            // them apart: `OpenAiProvider::name()` is the hardcoded `"openai"`, so
            // a bare `register` here would REPLACE the BYOK slot outright and hand
            // every pass-through caller the donor's key.
            registry.register_as(
                OPENAI_CREDITS_PROVIDER_ID,
                Arc::new(OpenAiProvider::new(
                    client.clone(),
                    c.all_keys(),
                    c.base_url.clone(),
                    Arc::clone(&quota),
                )),
            );
        }

        registry
    }

    /// Register a provider under its own [`Provider::name`] id. Re-registering an
    /// existing id replaces the provider in place while preserving its position
    /// in the iteration order. This is the open extension point for provider
    /// plugins.
    pub fn register(&mut self, provider: Arc<dyn Provider>) {
        let id = provider.name();
        self.insert(id.to_string(), provider);
    }

    /// Register a provider under an **explicit** id instead of its own
    /// [`Provider::name`], for the case where one impl backs two slots (the
    /// classify tier reusing [`LocalProvider`]). The provider is wrapped so its
    /// `name()` reports `id` too — see [`AliasedProvider`] for why reporting the
    /// inner name would cross-contaminate the two tiers' metrics and breaker
    /// state. Replacement/order semantics match [`Self::register`].
    pub fn register_as(&mut self, id: &'static str, provider: Arc<dyn Provider>) {
        self.insert(
            id.to_string(),
            Arc::new(AliasedProvider {
                id,
                inner: provider,
            }),
        );
    }

    /// Shared insert: append the id on first registration (preserving iteration
    /// order), then replace in place.
    fn insert(&mut self, id: String, provider: Arc<dyn Provider>) {
        if !self.providers.contains_key(&id) {
            self.order.push(id.clone());
        }
        self.providers.insert(id, provider);
    }

    /// Resolve a provider by its stable string id (e.g. `"openai"`). Returns
    /// `None` for an id with no registered/constructable provider — the same
    /// "provider absent/unavailable" signal the old closed match produced.
    pub fn get(&self, id: &str) -> Option<&dyn Provider> {
        self.providers.get(id).map(|p| p.as_ref())
    }

    /// The ids of all registered providers, in deterministic registration order.
    pub fn available_providers(&self) -> Vec<String> {
        self.order.clone()
    }
}

fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .expect("failed to build HTTP client")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        AnthropicProviderConfig, LocalProviderConfig, OpenAiProviderConfig, ProvidersConfig,
    };
    use serde_json::Value;
    use std::pin::Pin;

    fn quota() -> Arc<ProviderQuotas> {
        Arc::new(ProviderQuotas::new())
    }

    /// A no-op provider used to exercise registry mechanics (register / replace /
    /// order) without any network.
    struct StubProvider(&'static str);
    impl Provider for StubProvider {
        fn name(&self) -> &'static str {
            self.0
        }
        fn complete<'a>(
            &'a self,
            _model: &'a str,
            _body: &'a Value,
        ) -> Pin<
            Box<
                dyn std::future::Future<Output = Result<Value, ryu_gw_providers::ProviderError>>
                    + Send
                    + 'a,
            >,
        > {
            Box::pin(async move { Err(ryu_gw_providers::ProviderError::Provider("stub".into())) })
        }
        fn complete_stream<'a>(
            &'a self,
            _model: &'a str,
            _body: &'a Value,
        ) -> Pin<
            Box<
                dyn std::future::Future<
                        Output = Result<axum::body::Body, ryu_gw_providers::ProviderError>,
                    > + Send
                    + 'a,
            >,
        > {
            Box::pin(async move { Err(ryu_gw_providers::ProviderError::Provider("stub".into())) })
        }
    }

    #[test]
    fn empty_config_registers_no_providers() {
        let reg = ProviderRegistry::new(&ProvidersConfig::default(), quota());
        assert!(reg.available_providers().is_empty());
        assert!(reg.get("openai").is_none());
    }

    #[test]
    fn providers_register_in_deterministic_order_and_skip_absent() {
        // openai + anthropic present, everything else absent.
        let config = ProvidersConfig {
            openai: Some(OpenAiProviderConfig {
                api_key: "sk-openai".to_string(),
                api_keys: vec![],
                base_url: "https://api.openai.com/v1".to_string(),
            }),
            anthropic: Some(AnthropicProviderConfig {
                api_key: "sk-anthropic".to_string(),
                api_keys: vec![],
                base_url: "https://api.anthropic.com".to_string(),
            }),
            ..ProvidersConfig::default()
        };
        let reg = ProviderRegistry::new(&config, quota());
        // Registration order is openai-before-anthropic (matches `new`).
        assert_eq!(reg.available_providers(), vec!["openai", "anthropic"]);
        assert!(reg.get("openai").is_some());
        assert!(reg.get("anthropic").is_some());
        // A provider whose config is absent never enters the map.
        assert!(reg.get("local").is_none());
        assert!(reg.get("unknown").is_none());
    }

    #[test]
    fn get_resolves_provider_by_stable_id() {
        let config = ProvidersConfig {
            local: Some(LocalProviderConfig {
                base_url: "http://127.0.0.1:1234".to_string(),
            }),
            ..ProvidersConfig::default()
        };
        let reg = ProviderRegistry::new(&config, quota());
        assert_eq!(reg.get("local").map(Provider::name), Some("local"));
    }

    #[test]
    fn every_configured_builtin_registers_in_deterministic_order() {
        // A config with EVERY built-in present exercises each registration branch
        // and pins the deterministic order the /v1/models discovery merge relies on.
        let config: ProvidersConfig = serde_json::from_value(serde_json::json!({
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
        let reg = ProviderRegistry::new(&config, quota());
        // `classify` and the credit-pool slots are appended LAST: the /v1/models
        // discovery merge is order-sensitive, so a new provider must never be
        // inserted mid-list.
        assert_eq!(
            reg.available_providers(),
            vec![
                "openai",
                "anthropic",
                "local",
                "openrouter",
                "core",
                "modal",
                "genai",
                "replicate",
                "fal",
                "classify",
                "cloudflare",
                "bedrock",
                "vertex",
                "openai-credits",
            ]
        );
    }

    #[test]
    fn credit_pool_providers_report_their_own_ids_not_the_aliased_impl() {
        // All four reuse an existing impl (`OpenAiProvider` / `AnthropicProvider`),
        // whose `name()` is a hardcoded literal. If the alias leaked, `cloudflare`
        // would REPLACE `openai` in the map and every debit would be attributed to
        // the wrong pool — the exact money bug the pool split exists to prevent.
        let config: ProvidersConfig = serde_json::from_value(serde_json::json!({
            "openai": { "api_key": "sk-o" },
            "anthropic": { "api_key": "sk-a" },
            "cloudflare": { "api_key": "cf", "base_url": "https://cf.example/ai/v1" },
            "bedrock": { "api_key": "aws", "base_url": "https://bedrock.example/anthropic" },
            "vertex": { "api_key": "gcp", "base_url": "https://vertex.example/endpoints/openapi" },
            "openai_credits": { "api_key": "sk-donated" }
        }))
        .expect("providers config parses");
        let reg = ProviderRegistry::new(&config, quota());
        assert_eq!(reg.get("cloudflare").map(Provider::name), Some("cloudflare"));
        assert_eq!(reg.get("bedrock").map(Provider::name), Some("bedrock"));
        assert_eq!(reg.get("vertex").map(Provider::name), Some("vertex"));
        assert_eq!(reg.get("openai").map(Provider::name), Some("openai"));
        assert_eq!(reg.get("anthropic").map(Provider::name), Some("anthropic"));
    }

    #[test]
    fn donated_openai_is_a_separate_slot_from_the_byok_openai() {
        // The sharpest alias case: same impl, same endpoint, different KEY. Both
        // ids must exist side by side and each hold its own key, because
        // `credit_pools` tags one and not the other. A single slot would make
        // BYOK traffic debit the donated grant.
        let config: ProvidersConfig = serde_json::from_value(serde_json::json!({
            "openai": { "api_key": "sk-byok" },
            "openai_credits": { "api_key": "sk-donated" }
        }))
        .expect("providers config parses");
        let reg = ProviderRegistry::new(&config, quota());
        assert_eq!(reg.get("openai").map(Provider::name), Some("openai"));
        assert_eq!(
            reg.get("openai-credits").map(Provider::name),
            Some("openai-credits")
        );
        assert_eq!(reg.available_providers(), vec!["openai", "openai-credits"]);
    }

    #[test]
    fn donated_openai_does_not_stand_in_for_an_unconfigured_byok_slot() {
        // …nor the reverse. Only the id that was configured registers; a donated
        // allowance must never silently serve pass-through callers who have no key
        // of their own, since that spends donor credit on untagged traffic.
        let donated_only: ProvidersConfig = serde_json::from_value(serde_json::json!({
            "openai_credits": { "api_key": "sk-donated" }
        }))
        .expect("providers config parses");
        let reg = ProviderRegistry::new(&donated_only, quota());
        assert!(reg.get("openai").is_none());
        assert!(reg.get("openai-credits").is_some());

        let byok_only: ProvidersConfig = serde_json::from_value(serde_json::json!({
            "openai": { "api_key": "sk-byok" }
        }))
        .expect("providers config parses");
        let reg = ProviderRegistry::new(&byok_only, quota());
        assert!(reg.get("openai").is_some());
        assert!(reg.get("openai-credits").is_none());
    }

    #[test]
    fn credit_pool_providers_are_absent_when_unconfigured() {
        // An untagged deploy simply lacks the ids — no boot failure, no default
        // endpoint (the account/region/project-scoped base URLs have no sane
        // hardcoded value, and the donated OpenAI slot is gated on its own key).
        let reg = ProviderRegistry::new(&ProvidersConfig::default(), quota());
        assert!(reg.get("cloudflare").is_none());
        assert!(reg.get("bedrock").is_none());
        assert!(reg.get("vertex").is_none());
        assert!(reg.get("openai-credits").is_none());
    }

    #[test]
    fn classify_registers_as_its_own_provider_distinct_from_local() {
        // Both tiers configured at DIFFERENT urls: the classify slot must not
        // replace `local` (they share the `LocalProvider` impl, whose `name()` is
        // the hardcoded "local"), and each must report its own id so the
        // pipeline's metrics / admission / circuit-breaker keys stay separate.
        let config: ProvidersConfig = serde_json::from_value(serde_json::json!({
            "local": { "base_url": "http://127.0.0.1:11434/v1" },
            "classify": { "base_url": "http://127.0.0.1:8083/v1" }
        }))
        .expect("local + classify config parses");
        let reg = ProviderRegistry::new(&config, quota());
        assert_eq!(reg.get("local").map(Provider::name), Some("local"));
        assert_eq!(reg.get("classify").map(Provider::name), Some("classify"));
        assert_eq!(reg.available_providers(), vec!["local", "classify"]);
    }

    #[test]
    fn classify_absent_degrades_gracefully_to_no_provider() {
        // A STANDALONE gateway's state (NOT "the lazy sidecar's normal state" — Core
        // publishes RYU_CLASSIFY_LLM_URL unconditionally, so a Core-spawned gateway
        // always has the slot): no URL ⇒ no slot ⇒ no provider. `get` returns None
        // and the inspector fails open with a warn naming the provider — the
        // intended posture, not an error, so it is pinned here.
        let config: ProvidersConfig = serde_json::from_value(serde_json::json!({
            "local": { "base_url": "http://127.0.0.1:11434/v1" }
        }))
        .expect("local-only config parses");
        let reg = ProviderRegistry::new(&config, quota());
        assert!(reg.get("classify").is_none());
    }

    #[test]
    fn register_as_overrides_the_inner_providers_name() {
        // The isolation guarantee `register_as` exists for: the pipeline keys
        // metrics/admission/circuit-breaker off `provider.name()`, so the alias
        // must win over the wrapped provider's own hardcoded name.
        let mut reg = ProviderRegistry::new(&ProvidersConfig::default(), quota());
        reg.register_as("aliased", Arc::new(StubProvider("inner")));
        assert_eq!(reg.get("aliased").map(Provider::name), Some("aliased"));
        assert!(reg.get("inner").is_none());
        assert_eq!(reg.available_providers(), vec!["aliased"]);
    }

    #[test]
    fn register_appends_new_id_and_replaces_existing_in_place() {
        let mut reg = ProviderRegistry::new(&ProvidersConfig::default(), quota());
        reg.register(Arc::new(StubProvider("alpha")));
        reg.register(Arc::new(StubProvider("beta")));
        assert_eq!(reg.available_providers(), vec!["alpha", "beta"]);

        // Re-registering an existing id replaces the provider WITHOUT changing its
        // position in the iteration order (the open extension point for plugins).
        reg.register(Arc::new(StubProvider("alpha")));
        assert_eq!(
            reg.available_providers(),
            vec!["alpha", "beta"],
            "re-registering must not duplicate or reorder"
        );
    }
}
