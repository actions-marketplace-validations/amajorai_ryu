//! Governed, nonrecursive inference for routing. Algorithms never receive raw providers or keys.
use super::inference_governance::{
    self as governance, CompletionReceipt, InferenceClient, InputShape,
};
use super::*;
use crate::providers::{LocalProvider, Provider};
pub(super) use governance::authorize_model;
use sha2::Digest;

pub(super) fn scope(state: &AppState, ctx: &RequestContext) -> String {
    let policy = ctx
        .resolved_policy
        .clone()
        .unwrap_or_else(|| state.policy_snapshot());
    let scanner = state.resolved_scanner(ctx);
    let material = format!(
        "{}:{:?}:{:?}:{:?}:{:?}:{:?}",
        ctx.api_key,
        ctx.org_id,
        ctx.agent_id,
        ctx.user_id,
        policy,
        scanner.config()
    );
    format!("{:x}", Sha256::digest(material.as_bytes()))
}

pub(super) fn validate_config(
    config: &crate::config::SmartRoutingConfig,
) -> Result<(), GatewayError> {
    if config.rules.len() > 16
        || config
            .rules
            .iter()
            .any(|rule| rule.description.len() > 4096 || rule.model.len() > 256)
        || config.escalation_recent_message_window > 32
        || config.escalation_message_chars > 8192
    {
        return Err(GatewayError::BadRequest(
            "routing override exceeds routing limits".into(),
        ));
    }
    Ok(())
}

pub(super) struct GovernedInference {
    state: Arc<AppState>,
    parent: RequestContext,
    purpose: &'static str,
}
impl GovernedInference {
    pub(super) fn new(state: Arc<AppState>, parent: RequestContext, purpose: &'static str) -> Self {
        Self {
            state,
            parent,
            purpose,
        }
    }

    async fn dispatch(
        &self,
        model: &str,
        mut body: Value,
        embedding: bool,
        timeout_ms: u64,
    ) -> Result<Option<Value>, GatewayError> {
        let mut ctx = self.parent.clone();
        ctx.request_id = Uuid::new_v4().to_string();
        ctx.feature = Some(self.purpose.into());
        let start = Instant::now();
        let result = self
            .dispatch_inner(&ctx, model, &mut body, embedding, timeout_ms, start)
            .await;
        if let Err(error) = &result {
            audit_failure(&self.state, &ctx, model, error, start);
        }
        result
    }

    async fn dispatch_inner(
        &self,
        ctx: &RequestContext,
        model: &str,
        body: &mut Value,
        embedding: bool,
        timeout_ms: u64,
        start: Instant,
    ) -> Result<Option<Value>, GatewayError> {
        let state = &self.state;
        authorize_model(state, ctx, model)?;
        if !state
            .rate_limiter
            .check_request_for_key(&ctx.api_key, ctx.key_config.as_ref())
            || !state.rate_limiter.check_burst(&ctx.api_key)
        {
            return Err(GatewayError::RateLimited);
        }
        let mut decision = state.router.route(model);
        governance::enforce_lifetime_budget(state, ctx, body, &mut decision)?;
        let shape = if embedding {
            InputShape::Embedding
        } else {
            InputShape::Chat
        };
        governance::inspect_input(state, ctx, body, shape)?;
        let estimated_input = governance::input_token_estimate(body, shape);
        // Every auxiliary dispatch consumes token admission before egress; actual excess settles as debt.
        let admitted_tokens = estimated_input.saturating_add(if embedding {
            0
        } else {
            body["max_tokens"].as_u64().unwrap_or(8)
        });
        if !state.rate_limiter.check_tokens_for_key(
            &ctx.api_key,
            admitted_tokens,
            ctx.key_config.as_ref(),
        ) {
            return Err(GatewayError::RateLimited);
        }
        let local_embedding = embedding && state.config.providers.openai.is_none();
        if embedding {
            decision.provider =
                crate::config::ProviderId::from(if local_embedding { "local" } else { "openai" });
        }
        let original_ceiling = body["max_tokens"].as_u64().unwrap_or(8);
        let BudgetOutcome {
            decision: budget,
            reservation: initial_reservation,
            ..
        } = enforce_budget(
            state,
            ctx,
            body,
            &mut decision,
            BudgetChargeKind::Model,
            if embedding {
                OutputCeiling::Untouched
            } else {
                OutputCeiling::Clamp
            },
        )?;
        authorize_model(state, ctx, &decision.model)?;
        if !embedding {
            body["max_tokens"] = json!(body["max_tokens"]
                .as_u64()
                .unwrap_or(original_ceiling)
                .min(original_ceiling));
        }
        // A budget downgrade may change providers and therefore credit pools.
        // Re-admit the final target atomically instead of retaining a claim against the old pool.
        drop(initial_reservation);
        let reservation = if ctx.is_master_key {
            None
        } else {
            maybe_reserve_credit(
                state,
                ctx,
                body,
                crate::credit_pools::pool_for_gateway_provider(decision.provider.as_str()),
            )?
        };
        let input_reservation =
            governance::reserve_input_credit(state, ctx, &decision, estimated_input)?;
        body["model"] = json!(decision.model);
        let local_provider;
        let provider: &dyn Provider = if local_embedding {
            local_provider =
                LocalProvider::new(state.http.clone(), crate::config::local_embed_base_url());
            &local_provider
        } else {
            let Some(provider) = state.providers.get(decision.provider.as_str()) else {
                return Ok(None);
            };
            provider
        };
        if state.circuit_breaker.is_open(provider.name()) {
            return Ok(None);
        }
        let _admission = state
            .admission
            .acquire(provider.name(), ctx.priority)
            .await
            .map_err(|_| GatewayError::Overloaded("Routing provider is busy".into()))?;
        state.metrics.inc_provider_request(provider.name());
        let call = async {
            if embedding {
                provider.embed(&decision.model, body).await
            } else {
                provider.complete(&decision.model, body).await
            }
        };
        let response = match tokio::time::timeout(
            std::time::Duration::from_millis(timeout_ms.clamp(1, 30_000)),
            call,
        )
        .await
        {
            Ok(Ok(value)) => value,
            Ok(Err(error)) => {
                let error = GatewayError::from(error);
                if penalizes_provider_circuit(&error) {
                    state.circuit_breaker.record_failure(provider.name());
                }
                audit_failure(state, ctx, &decision.model, &error, start);
                return Ok(None);
            }
            Err(_) => {
                audit_failure(
                    state,
                    ctx,
                    &decision.model,
                    &GatewayError::ProviderError("Routing provider timed out".into()),
                    start,
                );
                return Ok(None);
            }
        };
        state.circuit_breaker.record_success(provider.name());
        let exceeded = governance::settle_completion(
            state,
            ctx,
            &response,
            CompletionReceipt {
                provider: provider.name().into(),
                model: decision.model.clone(),
                reason: self.purpose,
                audit_provider: provider.name().into(),
                backend: Some(if embedding {
                    "auxiliary-embedding"
                } else {
                    "auxiliary-classifier"
                }),
                start,
                admitted_tokens,
                estimated_input,
                budget,
                reservations: [reservation, input_reservation]
                    .into_iter()
                    .flatten()
                    .collect(),
                zero_cost: local_embedding,
            },
        );
        if exceeded.overrun {
            return Err(GatewayError::RateLimited);
        }
        Ok(Some(response))
    }
}

#[async_trait::async_trait]
impl InferenceClient for GovernedInference {
    fn scope(&self) -> String {
        scope(&self.state, &self.parent)
    }
    async fn complete(
        &self,
        model: &str,
        body: Value,
        timeout_ms: u64,
    ) -> Result<Option<Value>, GatewayError> {
        self.dispatch(model, body, false, timeout_ms).await
    }
    async fn embed(
        &self,
        model: &str,
        text: &str,
        timeout_ms: u64,
    ) -> Result<Option<Vec<f32>>, GatewayError> {
        let Some(response) = self
            .dispatch(
                model,
                json!({"model":model, "input":text}),
                true,
                timeout_ms,
            )
            .await?
        else {
            return Ok(None);
        };
        let Some(values) = response["data"][0]["embedding"]
            .as_array()
            .filter(|values| values.len() <= 8192)
        else {
            return Ok(None);
        };
        Ok(values
            .iter()
            .map(|value| value.as_f64().filter(|v| v.is_finite()).map(|v| v as f32))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        config::{
            FirewallConfig, FirewallPolicy, GatewayConfig, ProviderId, SmartRoutingConfig,
            SmartRule,
        },
        router::smart::SmartRouter,
    };
    use std::{pin::Pin, sync::Mutex};

    #[derive(Default)]
    struct RecordingProvider {
        requests: Mutex<Vec<Value>>,
        response_text: Mutex<Option<String>>,
    }
    impl Provider for RecordingProvider {
        fn name(&self) -> &'static str {
            "openai"
        }
        fn complete<'a>(
            &'a self,
            _model: &'a str,
            body: &'a Value,
        ) -> Pin<
            Box<
                dyn std::future::Future<Output = Result<Value, ryu_gw_providers::ProviderError>>
                    + Send
                    + 'a,
            >,
        > {
            Box::pin(async move {
                self.requests.lock().unwrap().push(body.clone());
                let content = self
                    .response_text
                    .lock()
                    .unwrap()
                    .clone()
                    .unwrap_or_else(|| {
                        if body["max_tokens"] == 4 {
                            "ESCALATE".into()
                        } else {
                            "1".into()
                        }
                    });
                Ok(
                    json!({"choices":[{"message":{"content":content}}],"usage":{"prompt_tokens":20,"completion_tokens":1,"cost":0.001}}),
                )
            })
        }
        fn complete_stream<'a>(
            &'a self,
            _model: &'a str,
            body: &'a Value,
        ) -> Pin<
            Box<
                dyn std::future::Future<Output = Result<Body, ryu_gw_providers::ProviderError>>
                    + Send
                    + 'a,
            >,
        > {
            Box::pin(async move {
                self.requests.lock().unwrap().push(body.clone());
                let text = self
                    .response_text
                    .lock()
                    .unwrap()
                    .clone()
                    .unwrap_or_else(|| "hello".into());
                let delta = json!({"choices":[{"delta":{"content":text}}]});
                let usage = json!({"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":10,"cost":0.002}});
                Ok(Body::from(format!(
                    "data: {delta}\n\ndata: {usage}\n\ndata: [DONE]\n\n"
                )))
            })
        }
        fn embed<'a>(
            &'a self,
            _model: &'a str,
            body: &'a Value,
        ) -> Pin<
            Box<
                dyn std::future::Future<Output = Result<Value, ryu_gw_providers::ProviderError>>
                    + Send
                    + 'a,
            >,
        > {
            Box::pin(async move {
                self.requests.lock().unwrap().push(body.clone());
                Ok(
                    json!({"data":[{"embedding":[1.0,0.0]}],"usage":{"prompt_tokens":20,"cost":0.001}}),
                )
            })
        }
        fn rerank<'a>(
            &'a self,
            model: &'a str,
            body: &'a Value,
        ) -> Pin<
            Box<
                dyn std::future::Future<Output = Result<Value, ryu_gw_providers::ProviderError>>
                    + Send
                    + 'a,
            >,
        > {
            self.embed(model, body)
        }
    }
    fn routing() -> SmartRoutingConfig {
        SmartRoutingConfig {
            enabled: true,
            classifier_model: "test".into(),
            cache_by_session: false,
            rules: vec![SmartRule {
                description: "coding".into(),
                model: "test".into(),
                weight: 1.0,
            }],
            ..Default::default()
        }
    }
    fn fixture(
        configure: impl FnOnce(&mut GatewayConfig),
    ) -> (Arc<AppState>, Arc<RecordingProvider>) {
        let mut config = GatewayConfig::default();
        config.routing.default_provider = ProviderId::from("openai");
        config.routing.fallback_chain = vec![ProviderId::from("openai")];
        config.routing.smart_routing = routing();
        config.providers.openai = Some(
            serde_json::from_value(
                json!({"api_key":"test-key","base_url":"http://127.0.0.1:1/v1"}),
            )
            .unwrap(),
        );
        config.firewall = FirewallConfig {
            enabled: false,
            ..Default::default()
        };
        configure(&mut config);
        let audit = crate::audit::AuditLogger::new(&crate::config::AuditConfig {
            enabled: false,
            db_path: String::new(),
        })
        .unwrap();
        let mut state = AppState::new_for_test(
            config,
            audit,
            crate::evals::EvalsRunner::new(Default::default()),
        );
        if state.config.semantic_cache.enabled {
            state.semantic_cache = crate::semantic_cache::SemanticCacheRegistry::from_cache(
                SemanticCache::new(state.config.semantic_cache.clone(), 60),
            );
        }
        let provider = Arc::new(RecordingProvider::default());
        state.providers.register(provider.clone());
        (Arc::new(state), provider)
    }
    fn ctx() -> RequestContext {
        super::super::test_support::plain_request_context()
    }
    fn prompt() -> Value {
        json!({"model":"test","messages":[{"role":"user","content":"coding"}]})
    }

    #[tokio::test]
    async fn exhausted_wallet_stops_every_routing_strategy_before_dispatch() {
        for embedding in [false, true] {
            let (state, provider) = fixture(|_| {});
            let mut context = ctx();
            context.managed_inference = true;
            context.org_id = Some("org".into());
            context.remaining_budget_micro_usd = Some(0);
            let client = GovernedInference::new(state, context, "smart-routing");
            let result = if embedding {
                client.embed("test", "coding", 100).await.map(|_| ())
            } else {
                client.complete("test", prompt(), 100).await.map(|_| ())
            };
            assert!(matches!(result, Err(GatewayError::InsufficientCredits)));
            assert!(provider.requests.lock().unwrap().is_empty());
        }
    }
    #[tokio::test]
    async fn rate_and_firewall_denials_precede_classifier_calls_on_both_pipelines() {
        for stream in [false, true] {
            for firewall in [false, true] {
                let (state, provider) = fixture(|config| {
                    if firewall {
                        config.firewall.enabled = true;
                        config.firewall.policy = FirewallPolicy::Block;
                    } else {
                        config.rate_limit.requests_per_minute = Some(0);
                    }
                });
                let mut body = prompt();
                if firewall {
                    body["messages"][0]["content"] =
                        json!("ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD");
                }
                let result = if stream {
                    run_stream(state, ctx(), body).await.map(|_| ())
                } else {
                    run(state, ctx(), body).await.map(|_| ())
                };
                assert!(result.is_err());
                assert!(provider.requests.lock().unwrap().is_empty());
            }
        }
    }
    #[tokio::test]
    async fn classifier_escalation_and_embedding_remain_functional_and_metered() {
        for strategy in 0..3 {
            let (state, provider) = fixture(|_| {});
            let mut config = routing();
            if strategy == 1 {
                config.router_type = crate::config::ModelRouterType::Escalation;
                config.escalation_weak_model = "weak".into();
                config.escalation_strong_model = "strong".into();
                config.escalation_judge_model = "test".into();
                config.escalation_confirmations = 1;
            }
            if strategy == 2 {
                config.strategy = crate::config::RouteStrategy::Embedding;
                config.embedding_model = "test".into();
            }
            let router = SmartRouter::new(config);
            let client = GovernedInference::new(state.clone(), ctx(), "smart-routing");
            let result = router
                .resolve(&prompt()["messages"], None, &client)
                .await
                .unwrap();
            assert_eq!(
                result.as_deref(),
                Some(if strategy == 1 { "strong" } else { "test" })
            );
            assert!(!provider.requests.lock().unwrap().is_empty());
            assert!(
                state
                    .metrics
                    .total_input_tokens
                    .load(std::sync::atomic::Ordering::Relaxed)
                    > 0
            );
        }
    }
    #[tokio::test]
    async fn auxiliary_dlp_inspects_rule_text_and_sanitizes_embedding_input() {
        let (state, provider) = fixture(|config| {
            config.firewall.enabled = true;
            config.firewall.policy = FirewallPolicy::Sanitize;
        });
        let client = GovernedInference::new(state, ctx(), "smart-routing");
        let secret = "ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD";
        client.embed("test", secret, 100).await.unwrap();
        let requests = provider.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert!(!requests[0]["input"].as_str().unwrap().contains(secret));
    }
    #[test]
    fn untrusted_overrides_never_enter_the_cache_and_trusted_cache_is_bounded() {
        let (state, _) = fixture(|_| {});
        let context = ctx();
        let mut body = json!({"ryu_smart_route":routing()});
        assert!(
            super::super::per_request_smart_router(&state, &context, &mut body)
                .unwrap()
                .is_none()
        );
        assert!(body.get("ryu_smart_route").is_none());
        assert_eq!(state.per_agent_routers.len(), 0);
        let mut trusted = context;
        trusted.is_master_key = true;
        for i in 0..100 {
            let mut config = routing();
            config.random_seed = Some(i);
            let mut body = json!({"ryu_smart_route":config});
            super::super::per_request_smart_router(&state, &trusted, &mut body).unwrap();
        }
        assert_eq!(state.per_agent_routers.len(), 64);
    }
    #[tokio::test]
    async fn paid_auxiliary_calls_have_distinct_audit_and_budget_records() {
        let (state, provider) = fixture(|config| {
            config.budgets.users.insert(
                "user".into(),
                serde_json::from_value(json!({"limit":1500})).unwrap(),
            );
        });
        let mut context = ctx();
        context.user_id = Some("user".into());
        context.session_id = Some("session".into());
        let mut events = state.traffic.subscribe();
        let client = GovernedInference::new(state.clone(), context, "smart-routing");
        client.complete("test", prompt(), 100).await.unwrap();
        client.complete("test", prompt(), 100).await.unwrap();
        let first = events.try_recv().unwrap();
        let second = events.try_recv().unwrap();
        assert_ne!(first["request_id"], second["request_id"]);
        assert_ne!(first["request_id"], "test-req");
        assert_eq!(first["session_id"], "session");
        assert_eq!(first["provider_cost_micro_usd"], 1000);
        assert_eq!(state.audit.token_usage("sk-test"), 42);
        assert!(matches!(
            client.complete("test", prompt(), 100).await,
            Err(GatewayError::BudgetExceeded(_))
        ));
        assert_eq!(provider.requests.lock().unwrap().len(), 2);
    }
    #[tokio::test]
    async fn routing_propagates_denials_and_does_not_poison_cached_probes() {
        let (state, provider) = fixture(|_| {});
        let mut context = ctx();
        context.resolved_policy = Some(crate::policy::EffectivePolicy {
            approved_models: vec!["allowed".into()],
            ..Default::default()
        });
        let client = GovernedInference::new(state.clone(), context, "smart-routing");
        let router = SmartRouter::new(routing());
        assert!(matches!(
            router.resolve(&prompt()["messages"], None, &client).await,
            Err(GatewayError::PolicyViolation(_))
        ));
        assert!(provider.requests.lock().unwrap().is_empty());
        let permitted = GovernedInference::new(state, ctx(), "smart-routing");
        assert_eq!(
            router
                .resolve(&prompt()["messages"], None, &permitted)
                .await
                .unwrap()
                .as_deref(),
            Some("test")
        );
    }
    #[tokio::test]
    async fn denied_outer_requests_do_not_allocate_override_cache_entries() {
        let (state, provider) = fixture(|config| config.rate_limit.requests_per_minute = Some(0));
        let mut context = ctx();
        context.is_master_key = true;
        let mut body = prompt();
        body["ryu_smart_route"] = json!(routing());
        assert!(matches!(
            run(state.clone(), context, body).await,
            Err(GatewayError::RateLimited)
        ));
        assert_eq!(state.per_agent_routers.len(), 0);
        assert!(provider.requests.lock().unwrap().is_empty());
    }
    fn embedding_body(operation: EmbeddingOperation, text: &str) -> Value {
        match operation {
            EmbeddingOperation::Embed => json!({"model":"test","input":[text]}),
            EmbeddingOperation::Rerank => {
                json!({"model":"test","query":text,"documents":[text,"public"]})
            }
        }
    }
    #[tokio::test]
    async fn embedding_endpoints_block_secrets_and_unapproved_models_before_dispatch() {
        for operation in [EmbeddingOperation::Embed, EmbeddingOperation::Rerank] {
            for locked in [false, true] {
                let (state, provider) = fixture(|config| {
                    config.firewall.enabled = !locked;
                    config.firewall.policy = FirewallPolicy::Block;
                });
                let mut context = ctx();
                if locked {
                    context.resolved_policy = Some(crate::policy::EffectivePolicy {
                        locked_guardrails: vec!["secrets".into()],
                        ..Default::default()
                    });
                }
                let result = run_embedding(
                    state,
                    context,
                    embedding_body(operation, "ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD"),
                    operation,
                )
                .await;
                assert!(matches!(
                    result,
                    Err(GatewayError::FirewallBlocked(..) | GatewayError::PolicyViolation(_))
                ));
                assert!(provider.requests.lock().unwrap().is_empty());
            }
            let (state, provider) = fixture(|_| {});
            let mut context = ctx();
            context.resolved_policy = Some(crate::policy::EffectivePolicy {
                approved_models: vec!["allowed".into()],
                ..Default::default()
            });
            assert!(matches!(
                run_embedding(state, context, embedding_body(operation, "safe"), operation).await,
                Err(GatewayError::PolicyViolation(_))
            ));
            assert!(provider.requests.lock().unwrap().is_empty());
        }
    }
    #[tokio::test]
    async fn embedding_endpoints_sanitize_every_input_field_and_preserve_arrays() {
        for operation in [EmbeddingOperation::Embed, EmbeddingOperation::Rerank] {
            let (state, provider) = fixture(|config| {
                config.firewall.enabled = true;
                config.firewall.policy = FirewallPolicy::Sanitize;
            });
            let secret = "ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD";
            run_embedding(state, ctx(), embedding_body(operation, secret), operation)
                .await
                .unwrap();
            let requests = provider.requests.lock().unwrap();
            assert_eq!(requests.len(), 1);
            assert!(!requests[0].to_string().contains(secret));
            match operation {
                EmbeddingOperation::Embed => assert!(requests[0]["input"].is_array()),
                EmbeddingOperation::Rerank => {
                    assert!(requests[0]["query"].is_string());
                    assert_eq!(requests[0]["documents"].as_array().unwrap().len(), 2);
                }
            }
            assert!(requests[0].get("messages").is_none());
        }
    }
    #[tokio::test]
    async fn embedding_overrun_is_charged_and_audited_before_429() {
        for operation in [EmbeddingOperation::Embed, EmbeddingOperation::Rerank] {
            let (state, provider) = fixture(|config| {
                config.rate_limit.tokens_per_minute = Some(10);
                config.budgets.users.insert(
                    "user".into(),
                    serde_json::from_value(json!({"limit":500})).unwrap(),
                );
            });
            let mut context = ctx();
            context.user_id = Some("user".into());
            let mut events = state.traffic.subscribe();
            assert!(matches!(
                run_embedding(
                    state.clone(),
                    context.clone(),
                    embedding_body(operation, "x"),
                    operation
                )
                .await,
                Err(GatewayError::RateLimited)
            ));
            assert_eq!(provider.requests.lock().unwrap().len(), 1);
            assert_eq!(state.audit.token_usage("sk-test"), 20);
            assert!(state
                .with_budget(|budget| budget.evaluate_charge(
                    Some("user"),
                    None,
                    BudgetChargeKind::Model
                ))
                .is_some());
            let event = events.try_recv().unwrap();
            assert_eq!(event["input_tokens"], 20);
            assert_eq!(event["provider_cost_micro_usd"], 1000);
            assert!(event["error"].is_string());
            assert!(
                run_embedding(state, context, embedding_body(operation, "x"), operation)
                    .await
                    .is_err()
            );
            assert_eq!(provider.requests.lock().unwrap().len(), 1);
        }
    }
    #[tokio::test]
    async fn inspector_uses_sanitized_text_and_accounts_before_main_completion() {
        let (state, provider) = fixture(|config| {
            config.routing.smart_routing.enabled = false;
            config.firewall.enabled = true;
            config.firewall.policy = FirewallPolicy::Sanitize;
            config.firewall.inspector.enabled = true;
            config.firewall.inspector.min_chars = 0;
            config.firewall.inspector.model = "test".into();
        });
        let secret = "ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD";
        let mut body = prompt();
        body["messages"][0]["content"] = json!(secret);
        let mut events = state.traffic.subscribe();
        run(state, ctx(), body).await.unwrap();
        let requests = provider.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(!requests[0].to_string().contains(secret));
        let first = events.try_recv().unwrap();
        assert_eq!(first["provider_cost_micro_usd"], 1000);
        assert_ne!(first["request_id"], "test-req");
    }
    #[tokio::test]
    async fn optional_inspector_and_semantic_cache_obey_empty_wallet_before_dispatch() {
        for inspector in [false, true] {
            let (state, provider) = fixture(|config| {
                config.routing.smart_routing.enabled = false;
                config.semantic_cache.enabled = !inspector;
                config.semantic_cache.embedding_model = "test".into();
                config.firewall.inspector.enabled = inspector;
                config.firewall.inspector.min_chars = 0;
                config.firewall.inspector.model = "test".into();
            });
            let mut context = ctx();
            context.managed_inference = true;
            context.org_id = Some("org".into());
            context.remaining_budget_micro_usd = Some(0);
            assert!(matches!(
                run(state, context, prompt()).await,
                Err(GatewayError::InsufficientCredits)
            ));
            assert!(provider.requests.lock().unwrap().is_empty());
        }
    }
    #[tokio::test]
    async fn semantic_cache_hit_still_accounts_its_embedding() {
        let (state, provider) = fixture(|config| {
            config.routing.smart_routing.enabled = false;
            config.semantic_cache.enabled = true;
            config.semantic_cache.embedding_model = "test".into();
            config.cache.enabled = false;
        });
        let mut events = state.traffic.subscribe();
        run(state.clone(), ctx(), prompt()).await.unwrap();
        let mut different = prompt();
        different["messages"][0]["content"] = json!("different wording");
        let result = run(state.clone(), ctx(), different).await.unwrap();
        assert!(result.cache_hit);
        assert_eq!(result.provider_used, "semantic-cache");
        assert_eq!(provider.requests.lock().unwrap().len(), 3);
        let mut paid = Vec::new();
        while let Ok(event) = events.try_recv() {
            if event["provider_cost_micro_usd"] == 1000 {
                paid.push(event);
            }
        }
        assert_eq!(paid.len(), 3);
        assert_eq!(state.audit.token_usage("sk-test"), 61);
    }
    #[tokio::test]
    async fn completed_chat_is_charged_when_output_dlp_or_evaluator_blocks() {
        for evaluator in [false, true] {
            let (state, provider) = fixture(|config| {
                config.routing.smart_routing.enabled = false;
                config.firewall.enabled = !evaluator;
                config.firewall.policy = FirewallPolicy::Block;
                if evaluator {
                    let mut ev = EvaluatorRegistry::new().get("pii_leakage").unwrap().clone();
                    ev.target = EvaluatorTarget::Output;
                    config.custom_evaluators.push(ev);
                    config
                        .firewall
                        .evaluators
                        .push(crate::evaluators::EvaluatorBinding {
                            id: "pii_leakage".into(),
                            enabled: true,
                            inline_action: Some(FirewallPolicy::Block),
                            offline: None,
                            locked: false,
                        });
                }
            });
            *provider.response_text.lock().unwrap() = Some(if evaluator {
                "private email: alice@example.com".into()
            } else {
                "ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD".into()
            });
            let mut events = state.traffic.subscribe();
            assert!(matches!(
                run(state.clone(), ctx(), prompt()).await,
                Err(GatewayError::FirewallBlocked(..))
            ));
            assert_eq!(state.audit.token_usage("sk-test"), 21);
            let mut paid = Vec::new();
            while let Ok(event) = events.try_recv() {
                if event["provider_cost_micro_usd"] == 1000 {
                    paid.push(event);
                }
            }
            assert_eq!(paid.len(), 1);
            assert_eq!(paid[0]["input_tokens"], 20);
            assert!(paid[0]["error"].is_string());
            assert_eq!(provider.requests.lock().unwrap().len(), 1);
        }
    }
    #[tokio::test]
    async fn completed_chat_token_overrun_keeps_accounting() {
        let (state, provider) = fixture(|config| {
            config.routing.smart_routing.enabled = false;
            config.rate_limit.tokens_per_minute = Some(10);
        });
        let mut events = state.traffic.subscribe();
        assert!(matches!(
            run(state.clone(), ctx(), prompt()).await,
            Err(GatewayError::RateLimited)
        ));
        assert_eq!(state.audit.token_usage("sk-test"), 21);
        let event = events.try_recv().unwrap();
        assert_eq!(event["provider_cost_micro_usd"], 1000);
        assert_eq!(event["output_tokens"], 1);
        assert!(event["error"].is_string());
        assert_eq!(provider.requests.lock().unwrap().len(), 1);
    }
    #[tokio::test]
    async fn embedding_reserves_input_cost_before_dispatch() {
        let (state, provider) = fixture(|config| {
            config.credits.min_reserve_micro_usd = 1;
            config.control_plane.cost_per_1k_micro_usd = 1_000_000;
        });
        let mut context = ctx();
        context.managed_inference = true;
        context.org_id = Some("org".into());
        context.remaining_budget_micro_usd = Some(50_000);
        let body = embedding_body(EmbeddingOperation::Embed, &"a".repeat(1000));
        assert!(matches!(
            run_embedding(state, context, body, EmbeddingOperation::Embed).await,
            Err(GatewayError::InsufficientCredits)
        ));
        assert!(provider.requests.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn streaming_dlp_preserves_actual_usage_when_client_frames_are_replaced() {
        for policy in [FirewallPolicy::Block, FirewallPolicy::Sanitize] {
            let (state, provider) = fixture(|config| {
                config.routing.smart_routing.enabled = false;
                config.firewall.enabled = true;
                config.firewall.policy = policy.clone();
            });
            let secret = "ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD";
            *provider.response_text.lock().unwrap() = Some(secret.into());
            let mut events = state.traffic.subscribe();
            let output = run_stream(state.clone(), ctx(), prompt()).await.unwrap();
            let bytes = axum::body::to_bytes(output.body, 1024 * 1024)
                .await
                .unwrap();
            assert!(!String::from_utf8_lossy(&bytes).contains(secret));
            assert_eq!(state.audit.token_usage("sk-test"), 30);
            let event = events.try_recv().unwrap();
            assert_eq!(event["input_tokens"], 20);
            assert_eq!(event["output_tokens"], 10);
            assert_eq!(event["provider_cost_micro_usd"], 2000);
            assert!(
                events.try_recv().is_err(),
                "EOF plus Drop must not duplicate settlement"
            );
        }
    }
    #[tokio::test]
    async fn dropped_stream_settles_received_work_once_and_marks_estimates() {
        use futures_util::StreamExt;
        let (state, _) = fixture(|_| {});
        let mut events = state.traffic.subscribe();
        let chunk = format!(
            "data: {}\n\n",
            json!({"choices":[{"delta":{"content":"received output"}}]})
        );
        let chunks = futures_util::stream::once(async move {
            Ok::<_, std::io::Error>(axum::body::Bytes::from(chunk))
        })
        .chain(futures_util::stream::pending());
        let observed = attach_stream_observer(
            Body::from_stream(chunks),
            state.clone(),
            ctx(),
            "openai".into(),
            "test".into(),
            7,
            Instant::now(),
            None,
            None,
            None,
        );
        let mut stream = observed.into_data_stream();
        assert!(stream.next().await.unwrap().is_ok());
        drop(stream);
        let event = events.try_recv().unwrap();
        assert_eq!(event["input_tokens"], 7);
        assert!(event["output_tokens"].as_u64().unwrap() > 0);
        assert!(event["error"].as_str().unwrap().contains("estimated"));
        assert_eq!(
            state.audit.token_usage("sk-test"),
            event["input_tokens"].as_u64().unwrap() + event["output_tokens"].as_u64().unwrap()
        );
        assert!(events.try_recv().is_err());
    }
    #[tokio::test]
    async fn never_polled_stream_still_records_dispatched_prompt_on_drop() {
        let (state, _) = fixture(|_| {});
        let mut events = state.traffic.subscribe();
        let body = attach_stream_observer(
            Body::empty(),
            state.clone(),
            ctx(),
            "openai".into(),
            "test".into(),
            9,
            Instant::now(),
            None,
            None,
            None,
        );
        drop(body);
        let event = events.try_recv().unwrap();
        assert_eq!(event["input_tokens"], 9);
        assert!(event["error"].is_string());
        assert!(events.try_recv().is_err());
    }
    #[tokio::test]
    async fn oversized_stream_aborts_without_serving_unscanned_output() {
        let (state, provider) = fixture(|config| {
            config.routing.smart_routing.enabled = false;
            config.firewall.enabled = true;
            config.firewall.policy = FirewallPolicy::Block;
        });
        *provider.response_text.lock().unwrap() = Some("a".repeat(MAX_PROVIDER_STREAM_BYTES + 1));
        let mut events = state.traffic.subscribe();
        let output = run_stream(state.clone(), ctx(), prompt()).await.unwrap();
        let bytes = axum::body::to_bytes(output.body, 4096).await.unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("Unable to scan"));
        assert!(!text.contains(&"a".repeat(1000)));
        let event = events.try_recv().unwrap();
        assert!(event["error"].as_str().unwrap().contains("8 MiB"));
        assert!(state.audit.token_usage("sk-test") > 0);
    }
    struct LocalRecording(Arc<RecordingProvider>);
    impl Provider for LocalRecording {
        fn name(&self) -> &'static str {
            "local"
        }
        fn complete<'a>(
            &'a self,
            model: &'a str,
            body: &'a Value,
        ) -> Pin<
            Box<
                dyn std::future::Future<Output = Result<Value, ryu_gw_providers::ProviderError>>
                    + Send
                    + 'a,
            >,
        > {
            self.0.complete(model, body)
        }
        fn complete_stream<'a>(
            &'a self,
            model: &'a str,
            body: &'a Value,
        ) -> Pin<
            Box<
                dyn std::future::Future<Output = Result<Body, ryu_gw_providers::ProviderError>>
                    + Send
                    + 'a,
            >,
        > {
            self.0.complete_stream(model, body)
        }
    }
    #[tokio::test]
    async fn output_judge_reuses_single_local_engine_slot_after_generation_finishes() {
        for stream in [false, true] {
            let (mut state, provider) = fixture(|config| {
                config.routing.default_provider = ProviderId::from("local");
                config.routing.fallback_chain = vec![ProviderId::from("local")];
                config.routing.smart_routing.enabled = false;
                config.concurrency.enabled = true;
                config.concurrency.local_max_in_flight = 1;
                config.concurrency.local_max_queued = 0;
                config.firewall.inspector.model = "test".into();
                let mut ev = EvaluatorRegistry::new().get("toxicity").unwrap().clone();
                ev.target = EvaluatorTarget::Output;
                config.custom_evaluators.push(ev);
                config
                    .firewall
                    .evaluators
                    .push(crate::evaluators::EvaluatorBinding {
                        id: "toxicity".into(),
                        enabled: true,
                        inline_action: Some(FirewallPolicy::Block),
                        offline: None,
                        locked: false,
                    });
            });
            Arc::get_mut(&mut state)
                .unwrap()
                .providers
                .register(Arc::new(LocalRecording(provider.clone())));
            let run = async {
                if stream {
                    let output = run_stream(state, ctx(), prompt()).await?;
                    axum::body::to_bytes(output.body, 1024 * 1024)
                        .await
                        .unwrap();
                    Ok(())
                } else {
                    super::super::run(state, ctx(), prompt()).await.map(|_| ())
                }
            };
            tokio::time::timeout(std::time::Duration::from_secs(1), run)
                .await
                .expect("output judge must not deadlock")
                .expect("output judge must receive released slot");
            assert_eq!(provider.requests.lock().unwrap().len(), 2);
        }
    }
}
