//! Shared input governance and irreversible usage settlement for nonrecursive provider operations.
use super::*;

#[async_trait::async_trait]
pub(crate) trait InferenceClient: Send + Sync {
    fn scope(&self) -> String;
    async fn complete(
        &self,
        model: &str,
        body: Value,
        timeout_ms: u64,
    ) -> Result<Option<Value>, GatewayError>;
    async fn embed(
        &self,
        model: &str,
        text: &str,
        timeout_ms: u64,
    ) -> Result<Option<Vec<f32>>, GatewayError>;
}

pub(super) fn authorize_model(
    state: &AppState,
    ctx: &RequestContext,
    model: &str,
) -> Result<(), GatewayError> {
    if !ctx.is_master_key
        && !ctx
            .resolved_policy
            .clone()
            .unwrap_or_else(|| state.policy_snapshot())
            .allows_model(model)
    {
        return Err(GatewayError::PolicyViolation(format!(
            "Model '{model}' is not approved by control-plane policy"
        )));
    }
    Ok(())
}

#[derive(Clone, Copy)]
pub(super) enum InputShape {
    Chat,
    Embedding,
    Rerank,
}

/// Inspect every provider-bound text field, preserving the operation's original wire shape.
/// Embedding/rerank text is projected into messages solely to reuse the canonical DLP transforms.
pub(super) fn inspect_input(
    state: &AppState,
    ctx: &RequestContext,
    body: &mut Value,
    shape: InputShape,
) -> Result<Option<PolicyAlert>, GatewayError> {
    let mut projection = match shape {
        InputShape::Chat => json!({"messages":body["messages"].clone()}),
        InputShape::Embedding => {
            let values = match &body["input"] {
                Value::String(text) => vec![Value::String(text.clone())],
                Value::Array(values) if values.iter().all(Value::is_string) => values.clone(),
                _ => {
                    return Err(GatewayError::BadRequest(
                        "embedding input must be strings".into(),
                    ))
                }
            };
            json!({"messages":values.into_iter().map(|content| json!({"role":"user","content":content})).collect::<Vec<_>>()})
        }
        InputShape::Rerank => {
            let query = body["query"]
                .as_str()
                .ok_or_else(|| GatewayError::BadRequest("rerank query must be text".into()))?;
            let docs = body["documents"]
                .as_array()
                .filter(|docs| docs.iter().all(Value::is_string))
                .ok_or_else(|| {
                    GatewayError::BadRequest("rerank documents must be strings".into())
                })?;
            let mut messages = vec![json!({"role":"user","content":query})];
            messages.extend(
                docs.iter()
                    .map(|content| json!({"role":"user","content":content})),
            );
            json!({"messages":messages})
        }
    };
    let scanner = state.resolved_scanner(ctx);
    let text = extract_text_for_scanning(&projection);
    let policy = ctx
        .resolved_policy
        .clone()
        .unwrap_or_else(|| state.policy_snapshot());
    if !ctx.is_master_key
        && policy.requires_firewall()
        && scanner
            .scan_locked_guardrails(&text, &policy.locked_guardrails)
            .is_some()
    {
        return Err(GatewayError::PolicyViolation(
            "Provider input violates a locked guardrail".into(),
        ));
    }
    let mut alert = None;
    if let Some(hit) = scanner.scan_inbound(&text) {
        match scanner.policy() {
            FirewallPolicy::Block => {
                return Err(GatewayError::FirewallBlocked(
                    format!("Provider input blocked: {}", hit.pattern_name),
                    firewall_policy_alert(scanner.config(), ctx, "block"),
                ))
            }
            FirewallPolicy::Sanitize => sanitize_messages(&mut projection, scanner.as_ref()),
            FirewallPolicy::WarnAndContinue => {
                alert = firewall_policy_alert(scanner.config(), ctx, "notify")
            }
        }
    }
    if ctx.companion_source {
        scanner.companion_sanitize_messages(&mut projection["messages"]);
    }
    match shape {
        InputShape::Chat => body["messages"] = projection["messages"].take(),
        InputShape::Embedding => {
            let values: Vec<_> = projection["messages"]
                .as_array()
                .expect("projected messages")
                .iter()
                .map(|message| message["content"].clone())
                .collect();
            body["input"] = if body["input"].is_string() {
                values.into_iter().next().unwrap_or(json!(""))
            } else {
                json!(values)
            };
        }
        InputShape::Rerank => {
            let values = projection["messages"]
                .as_array()
                .expect("projected messages");
            body["query"] = values[0]["content"].clone();
            body["documents"] = json!(values[1..]
                .iter()
                .map(|message| message["content"].clone())
                .collect::<Vec<_>>());
        }
    }
    Ok(alert)
}

pub(super) fn input_token_estimate(body: &Value, shape: InputShape) -> u64 {
    let text = match shape {
        InputShape::Chat => extract_text_for_scanning(body),
        InputShape::Embedding => body["input"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| {
                body["input"]
                    .as_array()
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default()
            }),
        InputShape::Rerank => format!(
            "{}\n{}",
            body["query"].as_str().unwrap_or(""),
            body["documents"]
                .as_array()
                .map(|values| values
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join("\n"))
                .unwrap_or_default()
        ),
    };
    (text.chars().count() as u64).div_ceil(4)
}

pub(super) fn enforce_lifetime_budget(
    state: &AppState,
    ctx: &RequestContext,
    body: &mut Value,
    decision: &mut RouteDecision,
) -> Result<(), GatewayError> {
    if !ctx.is_master_key && state.shared_budget.is_shared_exceeded() {
        return Err(GatewayError::BudgetExceeded(None));
    }
    if let Some(key) = &ctx.key_config {
        if key
            .token_budget_total
            .is_some_and(|limit| limit > 0 && state.audit.token_usage(&ctx.api_key) >= limit)
        {
            if let Some(model) = &key.downgrade_to {
                *decision = state.router.route(model);
                body["model"] = json!(model);
            } else {
                return Err(GatewayError::BudgetExceeded(None));
            }
        }
    }
    Ok(())
}

/// Reserve input spend separately from the output ceiling used by the general budget gate.
/// Embedding/rerank operations have no generated-token ceiling, but their inputs still cost money.
pub(super) fn reserve_input_credit(
    state: &AppState,
    ctx: &RequestContext,
    decision: &RouteDecision,
    input_tokens: u64,
) -> Result<Option<CreditReservation>, GatewayError> {
    if !state.config.credits.reserve_enabled || ctx.is_master_key {
        return Ok(None);
    }
    let pool = crate::credit_pools::pool_for_gateway_provider(decision.provider.as_str());
    let (Some(org), Some(headroom)) = (ctx.org_id.as_deref(), credit_headroom_micro_usd(ctx, pool))
    else {
        return Ok(None);
    };
    let cost = state
        .config
        .credits
        .debit_amount_for_provider(
            Some(decision.provider.as_str()),
            state
                .config
                .control_plane
                .cost_for(&decision.model, input_tokens, 0),
        )
        .min(i64::MAX as u64) as i64;
    state
        .wallet
        .try_reserve(org, cost, headroom)
        .map(Some)
        .ok_or(GatewayError::InsufficientCredits)
}

pub(super) struct CompletionReceipt {
    pub provider: String,
    pub model: String,
    pub reason: &'static str,
    pub audit_provider: String,
    pub backend: Option<&'static str>,
    pub start: Instant,
    pub admitted_tokens: u64,
    pub estimated_input: u64,
    pub budget: Option<BudgetDecision>,
    pub reservations: Vec<CreditReservation>,
    pub zero_cost: bool,
}

/// Completed work is accounted immediately; its audit record is finalized on every exit,
/// including rejection/cancellation, after callers can attach output-policy and evaluation results.
pub(super) struct SettledCompletion {
    pub overrun: bool,
    state: Arc<AppState>,
    record: Option<AuditRecord>,
}
impl SettledCompletion {
    pub fn record_mut(&mut self) -> &mut AuditRecord {
        self.record.as_mut().expect("unfinalized completion")
    }
    pub fn fail(&mut self, error: &GatewayError) {
        self.record_mut().error = Some(error.to_string());
    }
}
impl Drop for SettledCompletion {
    fn drop(&mut self) {
        if let Some(record) = self.record.take() {
            self.state.log_audit(record);
        }
    }
}

/// Provider work has already happened. Settle all usage, audit and wallet accounting before
/// the caller can return a TPM error or reject the output. Reservations follow the debit task.
pub(super) fn settle_completion(
    state: &Arc<AppState>,
    ctx: &RequestContext,
    response: &Value,
    receipt: CompletionReceipt,
) -> SettledCompletion {
    let input = response["usage"]["prompt_tokens"]
        .as_u64()
        .or_else(|| response["usage"]["input_tokens"].as_u64())
        .or_else(|| response["usage"]["total_tokens"].as_u64())
        .unwrap_or(receipt.estimated_input);
    let output = response["usage"]["completion_tokens"]
        .as_u64()
        .or_else(|| response["usage"]["output_tokens"].as_u64())
        .unwrap_or(0);
    let total = input.saturating_add(output);
    let extra = total.saturating_sub(receipt.admitted_tokens);
    let overrun = extra > 0
        && !state
            .rate_limiter
            .check_tokens_for_key(&ctx.api_key, extra, ctx.key_config.as_ref());
    if overrun {
        state
            .rate_limiter
            .record_tokens_for_key(&ctx.api_key, extra, ctx.key_config.as_ref());
    }
    state.audit.add_tokens(&ctx.api_key, total);
    state.metrics.add_tokens(input, output);
    let reported = if receipt.zero_cost {
        Some(0.0)
    } else {
        response_reported_cost_usd(response)
    };
    let cost = response_cost_micro_usd(state, reported, input, output, &receipt.model);
    record_charged_budget(
        state,
        ctx,
        charged_budget_cost_micro_usd(
            state,
            Some(receipt.provider.as_str()),
            reported,
            input,
            output,
            &receipt.model,
        ),
    );
    let latency = receipt.start.elapsed().as_millis() as u64;
    let record = AuditRecord {
        request_id: ctx.request_id.clone(),
        api_key: ctx.api_key.clone(),
        user_name: ctx.user_name.clone(),
        org_id: ctx.org_id.clone(),
        team_id: ctx.team_id.clone(),
        project_id: ctx.project_id.clone(),
        provider: receipt.audit_provider,
        model: receipt.model.clone(),
        input_tokens: input,
        output_tokens: output,
        cache_hit: false,
        latency_ms: latency,
        eval_score: None,
        error: overrun.then(|| "provider usage exceeded token admission".into()),
        skill_ids: ctx.skill_ids.clone(),
        session_id: ctx.session_id.clone(),
        user_id: ctx.user_id.clone(),
        agent_id: ctx.agent_id.clone(),
        feature: ctx.feature.clone(),
        managed_inference: ctx.managed_inference,
        // Keep vendor-reported cost distinct from the catalog estimate used for settlement.
        provider_cost_micro_usd: reported.and_then(cost_usd_to_micro),
        event_type: crate::audit::EventType::ModelCall,
        backend: receipt.backend.map(str::to_owned),
        command: None,
        duration_ms: None,
        exit_code: None,
        widget_instance_id: None,
    };
    if let Some(org) = ctx.org_id.clone().filter(|org| !org.is_empty()) {
        if state.config.credits.is_active() {
            let state = Arc::clone(state);
            let ctx = ctx.clone();
            if let Ok(handle) = tokio::runtime::Handle::try_current() {
                handle.spawn(async move {
                    debit_wallet_for_request(
                        Arc::clone(&state),
                        org,
                        ctx.request_id,
                        receipt.reason,
                        cost,
                        state.config.credits.fail_closed && ctx.managed_inference,
                        receipt
                            .budget
                            .filter(|budget| budget.limit > 0 && budget.alert >= AlertTier::Warn)
                            .map(|budget| budget.alert),
                        crate::credit_pools::pool_for_gateway_provider(&receipt.provider),
                        DebitAttribution {
                            provider: Some(receipt.provider.into()),
                            model: Some(receipt.model),
                            input_tokens: Some(input),
                            output_tokens: Some(output),
                            duration_ms: Some(latency),
                            user_id: ctx.user_id,
                            estimated: Some(reported.is_none()),
                            ..Default::default()
                        },
                    )
                    .await;
                    drop(receipt.reservations);
                });
            } else {
                state.wallet.set_org_accounting_unavailable(&org, true);
            }
        }
    }
    SettledCompletion {
        overrun,
        state: Arc::clone(state),
        record: Some(record),
    }
}
