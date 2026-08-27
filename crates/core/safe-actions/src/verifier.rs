use crate::{
    canonical_json, sha256_canonical, ComparisonOp, Counterexample, EffectContract, FindingCode,
    FindingSeverity, JsonType, PlanNode, PlanValue, Policy, Predicate, ToolDescriptor,
    VerificationBindings, VerificationDecision, VerificationFinding, VerificationReport,
    VerifierInput, TOOL_PLAN_SCHEMA_VERSION,
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub const VERIFIER_VERSION: &str = "ryu-safe-actions/1";

const HARD_MAX_PLAN_BYTES: usize = 1024 * 1024;
const HARD_MAX_NODES: usize = 4096;
const HARD_MAX_DEPTH: usize = 64;
const MAX_IDENTIFIER_BYTES: usize = 128;
const MAX_TOOL_NAME_BYTES: usize = 256;
const MAX_POLICY_RULES_PER_SET: usize = 256;
const MAX_CATALOG_TOOLS: usize = 4096;

/// Verify a typed tool plan without executing it or consulting mutable state.
#[must_use]
pub fn verify(input: &VerifierInput) -> VerificationReport {
    let mut findings = Vec::new();
    let mut counterexamples = Vec::new();

    let canonical_plan = canonical_json(&input.plan);
    let canonical_plan_bytes = match &canonical_plan {
        Ok(bytes) => bytes.len(),
        Err(error) => {
            findings.push(finding(
                FindingSeverity::Error,
                FindingCode::InternalCanonicalization,
                format!("plan canonicalization failed: {error}"),
                None,
                "$",
            ));
            0
        }
    };

    let mut sorted_catalog = input.catalog.clone();
    sorted_catalog.sort_by(|left, right| {
        left.name.cmp(&right.name).then_with(|| {
            let left = canonical_json(left).unwrap_or_default();
            let right = canonical_json(right).unwrap_or_default();
            left.cmp(&right)
        })
    });

    let bindings = VerificationBindings {
        plan_hash: hash_or_empty(&input.plan, "plan", &mut findings),
        policy_hash: hash_or_empty(&input.policy, "policy", &mut findings),
        catalog_hash: hash_or_empty(&sorted_catalog, "catalog", &mut findings),
        agent_revision: input.agent_revision.clone(),
        verifier_version: VERIFIER_VERSION.to_owned(),
    };

    if input.plan.schema_version != TOOL_PLAN_SCHEMA_VERSION {
        findings.push(finding(
            FindingSeverity::Error,
            FindingCode::UnsupportedSchemaVersion,
            format!(
                "plan schema version {} is unsupported; expected {TOOL_PLAN_SCHEMA_VERSION}",
                input.plan.schema_version
            ),
            None,
            "$.schema_version",
        ));
    }

    if input.catalog.len() > MAX_CATALOG_TOOLS {
        findings.push(finding(
            FindingSeverity::Error,
            FindingCode::CatalogTooLarge,
            format!(
                "catalog has {} tools; hard limit is {MAX_CATALOG_TOOLS}",
                input.catalog.len()
            ),
            None,
            "$.catalog",
        ));
    }

    check_policy(&input.policy, &mut findings);
    let limits = effective_limits(&input.policy);
    if canonical_plan_bytes > limits.0 {
        findings.push(finding(
            FindingSeverity::Error,
            FindingCode::PlanTooLarge,
            format!(
                "canonical plan is {canonical_plan_bytes} bytes; limit is {}",
                limits.0
            ),
            None,
            "$",
        ));
    }

    let mut structure = Structure::default();
    collect_structure(&input.plan.root, 1, "$.root", &mut structure, &mut findings);
    let mut argument_hashes = BTreeMap::new();
    collect_argument_hashes(&input.plan.root, &mut argument_hashes, &mut findings);
    if structure.call_count == 0 {
        findings.push(finding(
            FindingSeverity::Error,
            FindingCode::EmptyPlan,
            "plan must contain at least one tool call".to_owned(),
            None,
            "$.root",
        ));
    }
    if structure.node_count > limits.1 {
        findings.push(finding(
            FindingSeverity::Error,
            FindingCode::TooManyNodes,
            format!(
                "plan has {} nodes; limit is {}",
                structure.node_count, limits.1
            ),
            None,
            "$.root",
        ));
    }
    if structure.max_depth > limits.2 {
        findings.push(finding(
            FindingSeverity::Error,
            FindingCode::PlanTooDeep,
            format!(
                "plan depth is {}; limit is {}",
                structure.max_depth, limits.2
            ),
            None,
            "$.root",
        ));
    }

    let catalog = build_catalog(&sorted_catalog, &mut findings);
    let mut invocation_resources = BTreeMap::new();
    let mut context = VerifyContext {
        policy: &input.policy,
        catalog: &catalog,
        all_call_ids: &structure.call_ids,
        findings: &mut findings,
        counterexamples: &mut counterexamples,
        invocation_resources: &mut invocation_resources,
    };
    let available = BTreeMap::new();
    if structure.node_count <= HARD_MAX_NODES && structure.max_depth <= HARD_MAX_DEPTH {
        verify_node(&input.plan.root, &available, "$.root", &mut context);
    }

    let decision = if findings
        .iter()
        .any(|item| item.severity == FindingSeverity::Error)
    {
        VerificationDecision::Denied
    } else if findings
        .iter()
        .any(|item| item.severity == FindingSeverity::Review)
    {
        VerificationDecision::NeedsReview
    } else {
        VerificationDecision::Proved
    };

    VerificationReport {
        decision,
        bindings,
        findings,
        counterexamples,
        argument_hashes,
        invocation_resources,
        node_count: structure.node_count,
        max_depth: structure.max_depth,
        canonical_plan_bytes,
    }
}

fn collect_argument_hashes(
    node: &PlanNode,
    hashes: &mut BTreeMap<String, String>,
    findings: &mut Vec<VerificationFinding>,
) {
    match node {
        PlanNode::Call { id, arguments, .. } => {
            hashes.insert(
                id.clone(),
                hash_or_empty(arguments, "call arguments", findings),
            );
        }
        PlanNode::Sequence { nodes, .. } | PlanNode::Parallel { nodes, .. } => {
            for child in nodes {
                collect_argument_hashes(child, hashes, findings);
            }
        }
        PlanNode::If {
            then_node,
            else_node,
            ..
        } => {
            collect_argument_hashes(then_node, hashes, findings);
            collect_argument_hashes(else_node, hashes, findings);
        }
    }
}

fn hash_or_empty<T: serde::Serialize>(
    value: &T,
    label: &str,
    findings: &mut Vec<VerificationFinding>,
) -> String {
    match sha256_canonical(value) {
        Ok(hash) => hash,
        Err(error) => {
            findings.push(finding(
                FindingSeverity::Error,
                FindingCode::InternalCanonicalization,
                format!("{label} hashing failed: {error}"),
                None,
                "$",
            ));
            String::new()
        }
    }
}

fn effective_limits(policy: &Policy) -> (usize, usize, usize) {
    (
        policy.limits.max_plan_bytes.min(HARD_MAX_PLAN_BYTES),
        policy.limits.max_nodes.min(HARD_MAX_NODES),
        policy.limits.max_depth.min(HARD_MAX_DEPTH),
    )
}

fn check_policy(policy: &Policy, findings: &mut Vec<VerificationFinding>) {
    if policy.limits.max_plan_bytes == 0
        || policy.limits.max_nodes == 0
        || policy.limits.max_depth == 0
        || policy.limits.max_plan_bytes > HARD_MAX_PLAN_BYTES
        || policy.limits.max_nodes > HARD_MAX_NODES
        || policy.limits.max_depth > HARD_MAX_DEPTH
    {
        findings.push(finding(
            FindingSeverity::Error,
            FindingCode::InvalidPolicyLimits,
            format!(
                "policy limits must be non-zero and no greater than {HARD_MAX_PLAN_BYTES} bytes, {HARD_MAX_NODES} nodes, and depth {HARD_MAX_DEPTH}"
            ),
            None,
            "$.policy.limits",
        ));
    }
    for (field, count) in [
        ("allow_tools", policy.allow_tools.len()),
        ("deny_tools", policy.deny_tools.len()),
        ("allowed_effects", policy.allowed_effects.len()),
        ("allowed_resources", policy.allowed_resources.len()),
        ("review_tools", policy.review_tools.len()),
        ("review_effects", policy.review_effects.len()),
    ] {
        if count > MAX_POLICY_RULES_PER_SET {
            findings.push(finding(
                FindingSeverity::Error,
                FindingCode::PolicyTooComplex,
                format!(
                    "policy field `{field}` has {count} entries; hard limit is {MAX_POLICY_RULES_PER_SET}"
                ),
                None,
                format!("$.policy.{field}"),
            ));
        }
    }
    for (field, patterns) in [
        ("allow_tools", &policy.allow_tools),
        ("deny_tools", &policy.deny_tools),
        ("review_tools", &policy.review_tools),
    ] {
        for pattern in patterns {
            if !valid_tool_pattern(pattern) {
                findings.push(finding(
                    FindingSeverity::Error,
                    FindingCode::InvalidToolPattern,
                    format!("invalid tool pattern `{pattern}`"),
                    None,
                    format!("$.policy.{field}"),
                ));
            }
        }
    }
    for pattern in &policy.allowed_resources {
        if !valid_resource_pattern(pattern) {
            findings.push(finding(
                FindingSeverity::Error,
                FindingCode::InvalidResourcePattern,
                format!("invalid resource pattern `{pattern}`"),
                None,
                "$.policy.allowed_resources",
            ));
        }
    }
}

/// Validate a policy without fabricating a tool plan.
#[must_use]
pub fn validate_policy(policy: &Policy) -> Vec<VerificationFinding> {
    let mut findings = Vec::new();
    check_policy(policy, &mut findings);
    findings
}

#[derive(Default)]
struct Structure {
    node_count: usize,
    call_count: usize,
    max_depth: usize,
    ids: BTreeSet<String>,
    call_ids: BTreeSet<String>,
}

fn collect_structure(
    node: &PlanNode,
    depth: usize,
    path: &str,
    structure: &mut Structure,
    findings: &mut Vec<VerificationFinding>,
) {
    structure.node_count = structure.node_count.saturating_add(1);
    structure.max_depth = structure.max_depth.max(depth);
    let id = node.id();
    if !valid_identifier(id) {
        findings.push(finding(
            FindingSeverity::Error,
            FindingCode::InvalidNodeId,
            format!("node id `{id}` must be 1-{MAX_IDENTIFIER_BYTES} ASCII letters, digits, `.`, `_`, or `-`"),
            Some(id),
            format!("{path}.id"),
        ));
    }
    if !structure.ids.insert(id.to_owned()) {
        findings.push(finding(
            FindingSeverity::Error,
            FindingCode::DuplicateNodeId,
            format!("node id `{id}` is used more than once"),
            Some(id),
            format!("{path}.id"),
        ));
    }
    if matches!(node, PlanNode::Call { .. }) {
        structure.call_count = structure.call_count.saturating_add(1);
        structure.call_ids.insert(id.to_owned());
    }
    match node {
        PlanNode::Call { tool, .. } => {
            if !valid_tool_name(tool) {
                findings.push(finding(
                    FindingSeverity::Error,
                    FindingCode::InvalidToolName,
                    format!("invalid tool name `{tool}`"),
                    Some(id),
                    format!("{path}.tool"),
                ));
            }
        }
        PlanNode::Sequence { nodes, .. } | PlanNode::Parallel { nodes, .. } => {
            for (index, child) in nodes.iter().enumerate() {
                collect_structure(
                    child,
                    depth.saturating_add(1),
                    &format!("{path}.nodes[{index}]"),
                    structure,
                    findings,
                );
            }
        }
        PlanNode::If {
            then_node,
            else_node,
            ..
        } => {
            collect_structure(
                then_node,
                depth.saturating_add(1),
                &format!("{path}.then_node"),
                structure,
                findings,
            );
            collect_structure(
                else_node,
                depth.saturating_add(1),
                &format!("{path}.else_node"),
                structure,
                findings,
            );
        }
    }
}

fn build_catalog<'a>(
    sorted: &'a [ToolDescriptor],
    findings: &mut Vec<VerificationFinding>,
) -> BTreeMap<&'a str, &'a ToolDescriptor> {
    let mut catalog = BTreeMap::new();
    for descriptor in sorted {
        if !valid_tool_name(&descriptor.name) {
            findings.push(finding(
                FindingSeverity::Error,
                FindingCode::InvalidToolName,
                format!("catalog contains invalid tool name `{}`", descriptor.name),
                None,
                "$.catalog",
            ));
        }
        if catalog
            .insert(descriptor.name.as_str(), descriptor)
            .is_some()
        {
            findings.push(finding(
                FindingSeverity::Error,
                FindingCode::DuplicateToolDescriptor,
                format!(
                    "catalog contains duplicate descriptor `{}`",
                    descriptor.name
                ),
                None,
                "$.catalog",
            ));
        }
        validate_supported_schema(
            &descriptor.input_schema,
            &format!("$.catalog[{}].input_schema", descriptor.name),
            findings,
        );
        validate_supported_schema(
            &descriptor.output_schema,
            &format!("$.catalog[{}].output_schema", descriptor.name),
            findings,
        );
    }
    catalog
}

struct VerifyContext<'a> {
    policy: &'a Policy,
    catalog: &'a BTreeMap<&'a str, &'a ToolDescriptor>,
    all_call_ids: &'a BTreeSet<String>,
    findings: &'a mut Vec<VerificationFinding>,
    counterexamples: &'a mut Vec<Counterexample>,
    invocation_resources: &'a mut BTreeMap<String, BTreeSet<String>>,
}

type AvailableOutputs = BTreeMap<String, Value>;

fn verify_node(
    node: &PlanNode,
    available: &AvailableOutputs,
    path: &str,
    context: &mut VerifyContext<'_>,
) -> AvailableOutputs {
    match node {
        PlanNode::Call {
            id,
            tool,
            arguments,
        } => verify_call(id, tool, arguments, available, path, context),
        PlanNode::Sequence { nodes, .. } => {
            let mut outputs = available.clone();
            for (index, child) in nodes.iter().enumerate() {
                outputs = verify_node(child, &outputs, &format!("{path}.nodes[{index}]"), context);
            }
            outputs
        }
        PlanNode::Parallel { id, nodes } => {
            if !context.policy.allow_parallel_reads {
                context.findings.push(finding(
                    FindingSeverity::Error,
                    FindingCode::ParallelDisabled,
                    "parallel execution is disabled by policy".to_owned(),
                    Some(id),
                    path,
                ));
            }
            check_parallel_read_only(node, path, context);
            let mut outputs = available.clone();
            for (index, child) in nodes.iter().enumerate() {
                // Every sibling sees only values that dominated the parallel
                // node, so cross-sibling references fail closed.
                let sibling_outputs =
                    verify_node(child, available, &format!("{path}.nodes[{index}]"), context);
                for (step_id, schema) in sibling_outputs {
                    if !available.contains_key(&step_id) {
                        outputs.insert(step_id, schema);
                    }
                }
            }
            outputs
        }
        PlanNode::If {
            id,
            predicate,
            then_node,
            else_node,
        } => {
            verify_predicate(
                predicate,
                available,
                &format!("{path}.predicate"),
                Some(id),
                context,
            );
            // Both branches are verified, but branch-local values do not
            // dominate work after the conditional in schema v1.
            let _ = verify_node(then_node, available, &format!("{path}.then_node"), context);
            let _ = verify_node(else_node, available, &format!("{path}.else_node"), context);
            available.clone()
        }
    }
}

fn verify_call(
    id: &str,
    tool: &str,
    arguments: &PlanValue,
    available: &AvailableOutputs,
    path: &str,
    context: &mut VerifyContext<'_>,
) -> AvailableOutputs {
    let Some(descriptor) = context.catalog.get(tool).copied() else {
        context.findings.push(finding(
            FindingSeverity::Error,
            FindingCode::UnknownTool,
            format!("tool `{tool}` is not present in the attested catalog"),
            Some(id),
            format!("{path}.tool"),
        ));
        validate_plan_value(
            arguments,
            None,
            available,
            &format!("{path}.arguments"),
            Some(id),
            context,
        );
        return available.clone();
    };

    check_tool_policy(
        id,
        tool,
        arguments,
        descriptor.contract.as_ref(),
        path,
        context,
    );
    validate_plan_value(
        arguments,
        Some(&descriptor.input_schema),
        available,
        &format!("{path}.arguments"),
        Some(id),
        context,
    );

    let mut outputs = available.clone();
    outputs.insert(id.to_owned(), descriptor.output_schema.clone());
    outputs
}

fn check_tool_policy(
    id: &str,
    tool: &str,
    arguments: &PlanValue,
    contract: Option<&EffectContract>,
    path: &str,
    context: &mut VerifyContext<'_>,
) {
    let denied = context
        .policy
        .deny_tools
        .iter()
        .any(|pattern| valid_tool_pattern(pattern) && tool_matches(pattern, tool));
    let allowed = context
        .policy
        .allow_tools
        .iter()
        .any(|pattern| valid_tool_pattern(pattern) && tool_matches(pattern, tool));
    if denied {
        context.findings.push(finding(
            FindingSeverity::Error,
            FindingCode::ToolDenied,
            format!("tool `{tool}` matches a deny rule"),
            Some(id),
            format!("{path}.tool"),
        ));
        context.counterexamples.push(Counterexample {
            node_id: id.to_owned(),
            tool: tool.to_owned(),
            effect: None,
            resource: None,
            reason: "deny rules take precedence over allow rules".to_owned(),
        });
    } else if !allowed {
        context.findings.push(finding(
            FindingSeverity::Error,
            FindingCode::ToolNotAllowed,
            format!("tool `{tool}` does not match an allow rule"),
            Some(id),
            format!("{path}.tool"),
        ));
        context.counterexamples.push(Counterexample {
            node_id: id.to_owned(),
            tool: tool.to_owned(),
            effect: None,
            resource: None,
            reason: "policy is default deny".to_owned(),
        });
    }

    if context
        .policy
        .review_tools
        .iter()
        .any(|pattern| valid_tool_pattern(pattern) && tool_matches(pattern, tool))
    {
        context.findings.push(finding(
            FindingSeverity::Review,
            FindingCode::ReviewRequired,
            format!("tool `{tool}` requires human review"),
            Some(id),
            format!("{path}.tool"),
        ));
    }

    let Some(contract) = contract else {
        context.findings.push(finding(
            FindingSeverity::Error,
            FindingCode::MissingEffectContract,
            format!("tool `{tool}` has no effect contract"),
            Some(id),
            format!("{path}.tool"),
        ));
        return;
    };
    if !contract.trust.is_verifiable() {
        context.findings.push(finding(
            FindingSeverity::Error,
            FindingCode::UntrustedEffectContract,
            format!("tool `{tool}` effect contract is not attested"),
            Some(id),
            format!("{path}.tool"),
        ));
    }
    if contract.effects.is_empty() {
        context.findings.push(finding(
            FindingSeverity::Error,
            FindingCode::MissingEffects,
            format!("tool `{tool}` declares no effects; absence is not proof of purity"),
            Some(id),
            format!("{path}.tool"),
        ));
    }
    if contract.resources.is_empty() && contract.resource_bindings.is_empty() {
        context.findings.push(finding(
            FindingSeverity::Error,
            FindingCode::MissingResources,
            format!("tool `{tool}` declares no affected resources"),
            Some(id),
            format!("{path}.tool"),
        ));
    }
    if contract.arguments_independent && !contract.resource_bindings.is_empty() {
        context.findings.push(finding(
            FindingSeverity::Error,
            FindingCode::InvalidResourceBinding,
            format!(
                "tool `{tool}` cannot declare both argument-independent resources and resource bindings"
            ),
            Some(id),
            format!("{path}.tool"),
        ));
    }
    if !contract.arguments_independent && contract.resource_bindings.is_empty() {
        context.findings.push(finding(
            FindingSeverity::Error,
            FindingCode::MissingResourceBindings,
            format!(
                "tool `{tool}` must derive affected resources from its call arguments or explicitly attest that they are argument-independent"
            ),
            Some(id),
            format!("{path}.arguments"),
        ));
    }
    for effect in &contract.effects {
        if !context.policy.allowed_effects.contains(effect) {
            context.findings.push(finding(
                FindingSeverity::Error,
                FindingCode::EffectNotAllowed,
                format!("effect `{effect:?}` from tool `{tool}` is not allowed"),
                Some(id),
                format!("{path}.tool"),
            ));
            context.counterexamples.push(Counterexample {
                node_id: id.to_owned(),
                tool: tool.to_owned(),
                effect: Some(*effect),
                resource: None,
                reason: "effect is outside the policy allow set".to_owned(),
            });
        }
        if context.policy.review_effects.contains(effect) {
            context.findings.push(finding(
                FindingSeverity::Review,
                FindingCode::ReviewRequired,
                format!("effect `{effect:?}` from tool `{tool}` requires human review"),
                Some(id),
                format!("{path}.tool"),
            ));
        }
    }
    let mut invocation_resources = contract.resources.clone();
    for binding in &contract.resource_bindings {
        match derive_resource(arguments, binding) {
            Ok(resource) => {
                invocation_resources.insert(resource);
            }
            Err((code, message)) => {
                context.findings.push(finding(
                    FindingSeverity::Error,
                    code,
                    format!("tool `{tool}` {message}"),
                    Some(id),
                    format!("{path}.arguments"),
                ));
            }
        }
    }
    context
        .invocation_resources
        .insert(id.to_owned(), invocation_resources.clone());
    for resource in &invocation_resources {
        if !valid_resource_identifier(resource) {
            context.findings.push(finding(
                FindingSeverity::Error,
                FindingCode::InvalidResource,
                format!("tool `{tool}` declares invalid resource `{resource}`"),
                Some(id),
                format!("{path}.tool"),
            ));
            continue;
        }
        if !context
            .policy
            .allowed_resources
            .iter()
            .any(|pattern| valid_resource_pattern(pattern) && resource_matches(pattern, resource))
        {
            context.findings.push(finding(
                FindingSeverity::Error,
                FindingCode::ResourceNotAllowed,
                format!("resource `{resource}` from tool `{tool}` is not allowed"),
                Some(id),
                format!("{path}.tool"),
            ));
            context.counterexamples.push(Counterexample {
                node_id: id.to_owned(),
                tool: tool.to_owned(),
                effect: None,
                resource: Some(resource.clone()),
                reason: "resource is outside the policy allow set".to_owned(),
            });
        }
    }
}

fn derive_resource(
    arguments: &PlanValue,
    binding: &crate::ResourceBinding,
) -> Result<String, (FindingCode, String)> {
    if binding.pointer.is_empty()
        || binding.pointer.len() > 256
        || parse_json_pointer(&binding.pointer).is_err()
        || binding.prefix.is_empty()
        || binding.prefix.len() > 256
        || !binding.prefix.is_ascii()
        || !binding.prefix.bytes().all(|byte| byte.is_ascii_graphic())
        || !matches!(binding.prefix.as_bytes().last(), Some(b':' | b'/'))
    {
        return Err((
            FindingCode::InvalidResourceBinding,
            format!(
                "declares invalid resource binding `{}` -> `{}`",
                binding.pointer, binding.prefix
            ),
        ));
    }
    let tokens = parse_json_pointer(&binding.pointer).map_err(|_| {
        (
            FindingCode::InvalidResourceBinding,
            format!("declares invalid resource pointer `{}`", binding.pointer),
        )
    })?;
    let selected = select_plan_value(arguments, &tokens).ok_or_else(|| {
        (
            FindingCode::UnresolvedResourceBinding,
            format!(
                "cannot resolve resource pointer `{}` to a literal string",
                binding.pointer
            ),
        )
    })?;
    let resource = format!("{}{}", binding.prefix, selected);
    if !valid_resource_identifier(&resource) {
        return Err((
            FindingCode::InvalidResource,
            format!(
                "derives unsafe resource `{resource}` from `{}`",
                binding.pointer
            ),
        ));
    }
    Ok(resource)
}

fn select_plan_value(value: &PlanValue, tokens: &[String]) -> Option<String> {
    if tokens.is_empty() {
        return match value {
            PlanValue::Literal {
                value: Value::String(value),
            } => Some(value.clone()),
            _ => None,
        };
    }
    match value {
        PlanValue::Object { fields } => select_plan_value(fields.get(&tokens[0])?, &tokens[1..]),
        PlanValue::Array { items } => {
            select_plan_value(items.get(tokens[0].parse::<usize>().ok()?)?, &tokens[1..])
        }
        PlanValue::Literal { value } => {
            let mut selected = value;
            for token in tokens {
                selected = match selected {
                    Value::Object(fields) => fields.get(token)?,
                    Value::Array(items) => items.get(token.parse::<usize>().ok()?)?,
                    _ => return None,
                };
            }
            selected.as_str().map(str::to_owned)
        }
        PlanValue::StepOutput { .. } => None,
    }
}

fn check_parallel_read_only(node: &PlanNode, path: &str, context: &mut VerifyContext<'_>) {
    let PlanNode::Parallel { id, nodes } = node else {
        return;
    };
    let mut calls = Vec::new();
    for child in nodes {
        collect_calls(child, &mut calls);
    }
    for (call_id, tool) in calls {
        let read_only = context
            .catalog
            .get(tool)
            .and_then(|descriptor| descriptor.contract.as_ref())
            .is_some_and(|contract| {
                contract.trust.is_verifiable()
                    && !contract.effects.is_empty()
                    && contract.effects.iter().all(|effect| effect.is_read_only())
            });
        if !read_only {
            context.findings.push(finding(
                FindingSeverity::Error,
                FindingCode::ParallelMutation,
                format!("parallel child `{call_id}` is not proved read-only"),
                Some(id),
                path,
            ));
            context.counterexamples.push(Counterexample {
                node_id: call_id.to_owned(),
                tool: tool.to_owned(),
                effect: context
                    .catalog
                    .get(tool)
                    .and_then(|descriptor| descriptor.contract.as_ref())
                    .and_then(|contract| {
                        contract
                            .effects
                            .iter()
                            .find(|effect| !effect.is_read_only())
                            .copied()
                    }),
                resource: None,
                reason: "schema v1 permits parallel execution only when every call is attested read-only"
                    .to_owned(),
            });
        }
    }
}

fn collect_calls<'a>(node: &'a PlanNode, output: &mut Vec<(&'a str, &'a str)>) {
    match node {
        PlanNode::Call { id, tool, .. } => output.push((id, tool)),
        PlanNode::Sequence { nodes, .. } | PlanNode::Parallel { nodes, .. } => {
            for child in nodes {
                collect_calls(child, output);
            }
        }
        PlanNode::If {
            then_node,
            else_node,
            ..
        } => {
            collect_calls(then_node, output);
            collect_calls(else_node, output);
        }
    }
}

fn verify_predicate(
    predicate: &Predicate,
    available: &AvailableOutputs,
    path: &str,
    node_id: Option<&str>,
    context: &mut VerifyContext<'_>,
) {
    match predicate {
        Predicate::Compare { left, op, right } => {
            let left_type = validate_plan_value(
                left,
                None,
                available,
                &format!("{path}.left"),
                node_id,
                context,
            );
            let right_type = validate_plan_value(
                right,
                None,
                available,
                &format!("{path}.right"),
                node_id,
                context,
            );
            if let (Some(left_type), Some(right_type)) = (left_type, right_type) {
                let compatible = comparison_types_compatible(left_type, right_type);
                let ordered = matches!(
                    (left_type, right_type),
                    (JsonType::Integer, JsonType::Integer) | (JsonType::String, JsonType::String)
                );
                let is_ordering = !matches!(op, ComparisonOp::Equal | ComparisonOp::NotEqual);
                if !compatible || (is_ordering && !ordered) {
                    context.findings.push(finding(
                        FindingSeverity::Error,
                        FindingCode::InvalidPredicate,
                        format!("comparison operands `{left_type:?}` and `{right_type:?}` are incompatible for `{op:?}`"),
                        node_id,
                        path,
                    ));
                }
            }
        }
        Predicate::All { predicates } | Predicate::Any { predicates } => {
            if predicates.is_empty() {
                context.findings.push(finding(
                    FindingSeverity::Error,
                    FindingCode::InvalidPredicate,
                    "all/any predicates must contain at least one predicate".to_owned(),
                    node_id,
                    path,
                ));
            }
            for (index, child) in predicates.iter().enumerate() {
                verify_predicate(
                    child,
                    available,
                    &format!("{path}.predicates[{index}]"),
                    node_id,
                    context,
                );
            }
        }
        Predicate::Not { predicate } => {
            verify_predicate(
                predicate,
                available,
                &format!("{path}.predicate"),
                node_id,
                context,
            );
        }
        Predicate::Exists { value } => {
            validate_plan_value(
                value,
                None,
                available,
                &format!("{path}.value"),
                node_id,
                context,
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn validate_plan_value(
    value: &PlanValue,
    expected_schema: Option<&Value>,
    available: &AvailableOutputs,
    path: &str,
    node_id: Option<&str>,
    context: &mut VerifyContext<'_>,
) -> Option<JsonType> {
    let actual_type = match value {
        PlanValue::Literal { value } => {
            validate_literal(value, expected_schema, path, node_id, context);
            Some(json_value_type(value))
        }
        PlanValue::Object { fields } => {
            check_expected_type(JsonType::Object, expected_schema, path, node_id, context);
            check_required_fields(fields.keys(), expected_schema, path, node_id, context);
            for (key, child) in fields {
                let child_schema = property_schema(expected_schema, key);
                if matches!(child_schema, SchemaLookup::Forbidden) {
                    context.findings.push(finding(
                        FindingSeverity::Error,
                        FindingCode::InputShapeMismatch,
                        format!("property `{key}` is forbidden by the input schema"),
                        node_id,
                        format!("{path}.fields.{key}"),
                    ));
                }
                validate_plan_value(
                    child,
                    child_schema.schema(),
                    available,
                    &format!("{path}.fields.{key}"),
                    node_id,
                    context,
                );
            }
            Some(JsonType::Object)
        }
        PlanValue::Array { items } => {
            check_expected_type(JsonType::Array, expected_schema, path, node_id, context);
            let item_schema = expected_schema.and_then(|schema| schema.get("items"));
            for (index, child) in items.iter().enumerate() {
                validate_plan_value(
                    child,
                    item_schema,
                    available,
                    &format!("{path}.items[{index}]"),
                    node_id,
                    context,
                );
            }
            Some(JsonType::Array)
        }
        PlanValue::StepOutput {
            step_id,
            pointer,
            value_type,
        } => {
            let Some(output_schema) = available.get(step_id) else {
                let (code, message) = if context.all_call_ids.contains(step_id) {
                    (
                        FindingCode::ReferenceNotDominating,
                        format!("step `{step_id}` does not dominate this reference"),
                    )
                } else {
                    (
                        FindingCode::InvalidReference,
                        format!("step `{step_id}` does not exist"),
                    )
                };
                context.findings.push(finding(
                    FindingSeverity::Error,
                    code,
                    message,
                    node_id,
                    path,
                ));
                check_expected_type(*value_type, expected_schema, path, node_id, context);
                return Some(*value_type);
            };
            match schema_at_pointer(output_schema, pointer) {
                Ok(Some(pointed_schema)) => {
                    if let Some(types) = schema_types(pointed_schema) {
                        if !types
                            .iter()
                            .any(|actual| schema_type_accepts(*actual, *value_type))
                        {
                            context.findings.push(finding(
                                FindingSeverity::Error,
                                FindingCode::TypeMismatch,
                                format!("reference declares `{value_type:?}` but output pointer has schema type(s) {types:?}"),
                                node_id,
                                path,
                            ));
                        }
                    }
                    if let Some(expected_schema) = expected_schema {
                        if !schema_assignable(pointed_schema, expected_schema) {
                            context.findings.push(finding(
                                FindingSeverity::Error,
                                FindingCode::InputShapeMismatch,
                                "referenced output schema is not structurally assignable to the destination input schema".to_owned(),
                                node_id,
                                path,
                            ));
                        }
                    }
                }
                Ok(None) => {}
                Err(PointerError::InvalidSyntax(message)) => context.findings.push(finding(
                    FindingSeverity::Error,
                    FindingCode::InvalidJsonPointer,
                    message,
                    node_id,
                    path,
                )),
                Err(PointerError::SchemaMismatch(message)) => context.findings.push(finding(
                    FindingSeverity::Error,
                    FindingCode::OutputPointerMismatch,
                    message,
                    node_id,
                    path,
                )),
            }
            check_expected_type(*value_type, expected_schema, path, node_id, context);
            Some(*value_type)
        }
    };
    actual_type
}

fn validate_literal(
    value: &Value,
    expected_schema: Option<&Value>,
    path: &str,
    node_id: Option<&str>,
    context: &mut VerifyContext<'_>,
) {
    let actual = json_value_type(value);
    check_expected_type(actual, expected_schema, path, node_id, context);
    match value {
        Value::Object(object) => {
            check_required_fields(object.keys(), expected_schema, path, node_id, context);
            for (key, child) in object {
                let child_schema = property_schema(expected_schema, key);
                if matches!(child_schema, SchemaLookup::Forbidden) {
                    context.findings.push(finding(
                        FindingSeverity::Error,
                        FindingCode::InputShapeMismatch,
                        format!("property `{key}` is forbidden by the input schema"),
                        node_id,
                        format!("{path}.{key}"),
                    ));
                }
                validate_literal(
                    child,
                    child_schema.schema(),
                    &format!("{path}.{key}"),
                    node_id,
                    context,
                );
            }
        }
        Value::Array(items) => {
            let item_schema = expected_schema.and_then(|schema| schema.get("items"));
            for (index, child) in items.iter().enumerate() {
                validate_literal(
                    child,
                    item_schema,
                    &format!("{path}[{index}]"),
                    node_id,
                    context,
                );
            }
        }
        _ => {}
    }
}

fn check_required_fields<'a>(
    keys: impl Iterator<Item = &'a String>,
    schema: Option<&Value>,
    path: &str,
    node_id: Option<&str>,
    context: &mut VerifyContext<'_>,
) {
    let present: BTreeSet<&str> = keys.map(String::as_str).collect();
    let Some(required) = schema
        .and_then(|value| value.get("required"))
        .and_then(Value::as_array)
    else {
        return;
    };
    for required_key in required.iter().filter_map(Value::as_str) {
        if !present.contains(required_key) {
            context.findings.push(finding(
                FindingSeverity::Error,
                FindingCode::InputShapeMismatch,
                format!("required property `{required_key}` is missing"),
                node_id,
                path,
            ));
        }
    }
}

enum SchemaLookup<'a> {
    Known(&'a Value),
    Unknown,
    Forbidden,
}

impl<'a> SchemaLookup<'a> {
    fn schema(&self) -> Option<&'a Value> {
        match self {
            Self::Known(schema) => Some(schema),
            Self::Unknown | Self::Forbidden => None,
        }
    }
}

fn property_schema<'a>(schema: Option<&'a Value>, key: &str) -> SchemaLookup<'a> {
    let Some(schema) = schema else {
        return SchemaLookup::Unknown;
    };
    if let Some(property) = schema
        .get("properties")
        .and_then(Value::as_object)
        .and_then(|properties| properties.get(key))
    {
        return SchemaLookup::Known(property);
    }
    match schema.get("additionalProperties") {
        Some(Value::Bool(false)) => SchemaLookup::Forbidden,
        Some(Value::Object(_)) => SchemaLookup::Known(&schema["additionalProperties"]),
        _ => SchemaLookup::Unknown,
    }
}

fn check_expected_type(
    actual: JsonType,
    expected_schema: Option<&Value>,
    path: &str,
    node_id: Option<&str>,
    context: &mut VerifyContext<'_>,
) {
    let Some(expected_types) = expected_schema.and_then(schema_types) else {
        return;
    };
    if !expected_types
        .iter()
        .any(|expected| schema_type_accepts(actual, *expected))
    {
        context.findings.push(finding(
            FindingSeverity::Error,
            FindingCode::TypeMismatch,
            format!("value has type `{actual:?}` but schema requires {expected_types:?}"),
            node_id,
            path,
        ));
    }
}

fn validate_supported_schema(schema: &Value, path: &str, findings: &mut Vec<VerificationFinding>) {
    if schema == &Value::Bool(true) {
        return;
    }
    let Some(object) = schema.as_object() else {
        findings.push(finding(
            FindingSeverity::Error,
            FindingCode::UnsupportedToolSchema,
            "tool schemas must be objects or the boolean `true` schema".to_owned(),
            None,
            path,
        ));
        return;
    };

    const SUPPORTED_KEYS: &[&str] = &[
        "$id",
        "$schema",
        "additionalProperties",
        "default",
        "deprecated",
        "description",
        "examples",
        "items",
        "properties",
        "readOnly",
        "required",
        "title",
        "type",
        "writeOnly",
    ];
    for key in object.keys() {
        if !SUPPORTED_KEYS.contains(&key.as_str()) {
            findings.push(finding(
                FindingSeverity::Error,
                FindingCode::UnsupportedToolSchema,
                format!("schema keyword `{key}` is not supported by verifier v1"),
                None,
                format!("{path}.{key}"),
            ));
        }
    }

    let Some(type_value) = object.get("type") else {
        findings.push(finding(
            FindingSeverity::Error,
            FindingCode::UnsupportedToolSchema,
            "schema must declare a supported `type`".to_owned(),
            None,
            path,
        ));
        return;
    };
    let valid_type = match type_value {
        Value::String(name) => json_type_from_name(name).is_some(),
        Value::Array(items) => {
            !items.is_empty()
                && items
                    .iter()
                    .all(|item| item.as_str().and_then(json_type_from_name).is_some())
                && items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<BTreeSet<_>>()
                    .len()
                    == items.len()
        }
        _ => false,
    };
    if !valid_type {
        findings.push(finding(
            FindingSeverity::Error,
            FindingCode::UnsupportedToolSchema,
            "schema `type` must contain unique supported JSON type names".to_owned(),
            None,
            format!("{path}.type"),
        ));
    }

    if let Some(properties) = object.get("properties") {
        let Some(properties) = properties.as_object() else {
            findings.push(finding(
                FindingSeverity::Error,
                FindingCode::UnsupportedToolSchema,
                "schema `properties` must be an object".to_owned(),
                None,
                format!("{path}.properties"),
            ));
            return;
        };
        for (name, child) in properties {
            validate_supported_schema(child, &format!("{path}.properties.{name}"), findings);
        }
    }

    if let Some(required) = object.get("required") {
        let valid_required = required.as_array().is_some_and(|items| {
            items.iter().all(Value::is_string)
                && items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<BTreeSet<_>>()
                    .len()
                    == items.len()
        });
        if !valid_required {
            findings.push(finding(
                FindingSeverity::Error,
                FindingCode::UnsupportedToolSchema,
                "schema `required` must contain unique property names".to_owned(),
                None,
                format!("{path}.required"),
            ));
        }
    }

    if let Some(additional) = object.get("additionalProperties") {
        match additional {
            Value::Bool(_) => {}
            Value::Object(_) => validate_supported_schema(
                additional,
                &format!("{path}.additionalProperties"),
                findings,
            ),
            _ => findings.push(finding(
                FindingSeverity::Error,
                FindingCode::UnsupportedToolSchema,
                "schema `additionalProperties` must be a boolean or schema".to_owned(),
                None,
                format!("{path}.additionalProperties"),
            )),
        }
    }

    if let Some(items) = object.get("items") {
        validate_supported_schema(items, &format!("{path}.items"), findings);
    }
}

fn schema_types(schema: &Value) -> Option<Vec<JsonType>> {
    let type_value = schema.get("type")?;
    match type_value {
        Value::String(name) => json_type_from_name(name).map(|item| vec![item]),
        Value::Array(items) => {
            let types: Vec<_> = items
                .iter()
                .filter_map(Value::as_str)
                .filter_map(json_type_from_name)
                .collect();
            (!types.is_empty()).then_some(types)
        }
        _ => None,
    }
}

/// Conservative subsumption for the finite JSON Schema subset accepted by
/// verifier v1. It returns true only when every value described by `source` is
/// accepted by `destination`; uncertainty therefore denies certification.
fn schema_assignable(source: &Value, destination: &Value) -> bool {
    if destination == &Value::Bool(true) {
        return true;
    }
    if source == &Value::Bool(true) || source == &Value::Bool(false) {
        return false;
    }
    if destination == &Value::Bool(false) {
        return false;
    }
    let (Some(source_types), Some(destination_types)) =
        (schema_types(source), schema_types(destination))
    else {
        return false;
    };
    if !source_types.iter().all(|source_type| {
        destination_types
            .iter()
            .any(|destination_type| schema_type_accepts(*source_type, *destination_type))
    }) {
        return false;
    }

    if source_types.contains(&JsonType::Object) {
        let source_properties = source
            .get("properties")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let destination_properties = destination
            .get("properties")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let source_required = schema_required(source);
        let destination_required = schema_required(destination);
        for key in destination_required {
            if !source_required.contains(key.as_str()) {
                return false;
            }
            let Some(source_property) = source_properties.get(&key) else {
                return false;
            };
            let Some(destination_property) = destination_properties.get(&key) else {
                return false;
            };
            if !schema_assignable(source_property, destination_property) {
                return false;
            }
        }
        for (key, source_property) in &source_properties {
            match property_schema(Some(destination), key) {
                SchemaLookup::Known(destination_property) => {
                    if !schema_assignable(source_property, destination_property) {
                        return false;
                    }
                }
                SchemaLookup::Forbidden => return false,
                SchemaLookup::Unknown => {}
            }
        }
        if destination.get("additionalProperties") == Some(&Value::Bool(false)) {
            if source.get("additionalProperties") != Some(&Value::Bool(false)) {
                return false;
            }
            if source_properties
                .keys()
                .any(|key| !destination_properties.contains_key(key))
            {
                return false;
            }
        } else if let Some(destination_additional @ Value::Object(_)) =
            destination.get("additionalProperties")
        {
            match source.get("additionalProperties") {
                Some(source_additional @ Value::Object(_)) => {
                    if !schema_assignable(source_additional, destination_additional) {
                        return false;
                    }
                }
                Some(Value::Bool(false)) => {}
                _ => return false,
            }
        }
    }

    if source_types.contains(&JsonType::Array) {
        match (source.get("items"), destination.get("items")) {
            (_, None) => {}
            (Some(source_items), Some(destination_items)) => {
                if !schema_assignable(source_items, destination_items) {
                    return false;
                }
            }
            (None, Some(_)) => return false,
        }
    }
    true
}

fn schema_required(schema: &Value) -> BTreeSet<String> {
    schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

/// Validate a fully materialized value against the same finite schema subset
/// used during proof. Execution invokes this immediately before dispatch, so a
/// provider cannot exploit a dynamic step-output shape that differs from its
/// attested output schema.
pub fn validate_runtime_value(value: &Value, schema: &Value) -> Result<(), String> {
    validate_runtime_value_at(value, schema, "$")
}

fn validate_runtime_value_at(value: &Value, schema: &Value, path: &str) -> Result<(), String> {
    if schema == &Value::Bool(true) {
        return Ok(());
    }
    if schema == &Value::Bool(false) {
        return Err(format!("{path} is forbidden by the tool input schema"));
    }
    let expected = schema_types(schema)
        .ok_or_else(|| format!("{path} has an unsupported tool input schema"))?;
    let actual = json_value_type(value);
    if !expected
        .iter()
        .any(|expected_type| schema_type_accepts(actual, *expected_type))
    {
        return Err(format!(
            "{path} has type {actual:?}, expected one of {expected:?}"
        ));
    }
    match value {
        Value::Object(object) => {
            for required in schema_required(schema) {
                if !object.contains_key(&required) {
                    return Err(format!("{path} is missing required property '{required}'"));
                }
            }
            for (key, child) in object {
                match property_schema(Some(schema), key) {
                    SchemaLookup::Known(child_schema) => {
                        validate_runtime_value_at(child, child_schema, &format!("{path}/{key}"))?
                    }
                    SchemaLookup::Forbidden => {
                        return Err(format!(
                            "{path}/{key} is forbidden by the tool input schema"
                        ))
                    }
                    SchemaLookup::Unknown => {}
                }
            }
        }
        Value::Array(items) => {
            if let Some(item_schema) = schema.get("items") {
                for (index, item) in items.iter().enumerate() {
                    validate_runtime_value_at(item, item_schema, &format!("{path}/{index}"))?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn json_type_from_name(name: &str) -> Option<JsonType> {
    match name {
        "null" => Some(JsonType::Null),
        "boolean" => Some(JsonType::Boolean),
        "number" => Some(JsonType::Number),
        "integer" => Some(JsonType::Integer),
        "string" => Some(JsonType::String),
        "array" => Some(JsonType::Array),
        "object" => Some(JsonType::Object),
        _ => None,
    }
}

fn json_value_type(value: &Value) -> JsonType {
    match value {
        Value::Null => JsonType::Null,
        Value::Bool(_) => JsonType::Boolean,
        Value::Number(number) if number.is_i64() || number.is_u64() => JsonType::Integer,
        Value::Number(_) => JsonType::Number,
        Value::String(_) => JsonType::String,
        Value::Array(_) => JsonType::Array,
        Value::Object(_) => JsonType::Object,
    }
}

fn schema_type_accepts(actual: JsonType, expected: JsonType) -> bool {
    actual == expected || matches!((actual, expected), (JsonType::Integer, JsonType::Number))
}

fn comparison_types_compatible(left: JsonType, right: JsonType) -> bool {
    left == right
        || matches!(
            (left, right),
            (JsonType::Integer, JsonType::Number) | (JsonType::Number, JsonType::Integer)
        )
}

enum PointerError {
    InvalidSyntax(String),
    SchemaMismatch(String),
}

fn schema_at_pointer<'a>(
    schema: &'a Value,
    pointer: &str,
) -> Result<Option<&'a Value>, PointerError> {
    let tokens = parse_json_pointer(pointer)?;
    let mut current = schema;
    for token in tokens {
        let types = schema_types(current);
        let may_be_object = types
            .as_ref()
            .is_none_or(|items| items.contains(&JsonType::Object));
        let may_be_array = types
            .as_ref()
            .is_none_or(|items| items.contains(&JsonType::Array));
        if may_be_object {
            match property_schema(Some(current), &token) {
                SchemaLookup::Known(next) => {
                    current = next;
                    continue;
                }
                SchemaLookup::Forbidden => {
                    return Err(PointerError::SchemaMismatch(format!(
                        "output pointer `{pointer}` selects forbidden property `{token}`"
                    )));
                }
                SchemaLookup::Unknown if types.is_none() => return Ok(None),
                SchemaLookup::Unknown => {}
            }
        }
        if may_be_array {
            if token.parse::<usize>().is_err() {
                return Err(PointerError::SchemaMismatch(format!(
                    "output pointer `{pointer}` uses non-numeric array index `{token}`"
                )));
            }
            let Some(items) = current.get("items") else {
                return Ok(None);
            };
            current = items;
            continue;
        }
        if types.is_some() {
            return Err(PointerError::SchemaMismatch(format!(
                "output pointer `{pointer}` traverses a scalar schema"
            )));
        }
        return Ok(None);
    }
    Ok(Some(current))
}

fn parse_json_pointer(pointer: &str) -> Result<Vec<String>, PointerError> {
    if pointer.is_empty() {
        return Ok(Vec::new());
    }
    if !pointer.starts_with('/') {
        return Err(PointerError::InvalidSyntax(format!(
            "JSON pointer `{pointer}` must be empty or start with `/`"
        )));
    }
    pointer[1..]
        .split('/')
        .map(|token| {
            let mut decoded = String::with_capacity(token.len());
            let mut chars = token.chars();
            while let Some(character) = chars.next() {
                if character != '~' {
                    decoded.push(character);
                    continue;
                }
                match chars.next() {
                    Some('0') => decoded.push('~'),
                    Some('1') => decoded.push('/'),
                    _ => {
                        return Err(PointerError::InvalidSyntax(format!(
                            "JSON pointer `{pointer}` contains an invalid `~` escape"
                        )))
                    }
                }
            }
            Ok(decoded)
        })
        .collect()
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_IDENTIFIER_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn valid_tool_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_TOOL_NAME_BYTES
        && !value.starts_with('.')
        && !value.ends_with('.')
        && !value.contains("..")
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':' | b'/')
        })
}

fn valid_tool_pattern(pattern: &str) -> bool {
    if let Some(prefix) = pattern.strip_suffix(".*") {
        valid_tool_name(prefix) && !prefix.contains('*')
    } else {
        valid_tool_name(pattern) && !pattern.contains('*')
    }
}

fn tool_matches(pattern: &str, tool: &str) -> bool {
    pattern.strip_suffix(".*").map_or_else(
        || pattern == tool,
        |prefix| {
            tool.strip_prefix(prefix)
                .is_some_and(|suffix| suffix.starts_with('.') && suffix.len() > 1)
        },
    )
}

fn valid_resource_pattern(pattern: &str) -> bool {
    !pattern.is_empty()
        && pattern.len() <= 1024
        && pattern.is_ascii()
        && pattern.bytes().all(|byte| byte.is_ascii_graphic())
        && !contains_unsafe_resource_path(pattern)
        && match pattern.strip_suffix("/*") {
            Some(prefix) => !prefix.is_empty() && !prefix.contains('*'),
            None => !pattern.contains('*'),
        }
}

fn valid_resource_identifier(resource: &str) -> bool {
    !resource.is_empty()
        && resource.len() <= 1024
        && resource.is_ascii()
        && resource.bytes().all(|byte| byte.is_ascii_graphic())
        && !resource.contains('*')
        && !contains_unsafe_resource_path(resource)
}

fn contains_unsafe_resource_path(value: &str) -> bool {
    let lowered = value.to_ascii_lowercase();
    if lowered.contains('\\')
        || lowered.contains("%2e")
        || lowered.contains("%2f")
        || lowered.contains("%5c")
    {
        return true;
    }
    lowered
        .split('/')
        .any(|segment| matches!(segment, "." | ".."))
}

fn resource_matches(pattern: &str, resource: &str) -> bool {
    pattern.strip_suffix("/*").map_or_else(
        || pattern == resource,
        |prefix| {
            resource
                .strip_prefix(prefix)
                .is_some_and(|suffix| suffix.starts_with('/') && suffix.len() > 1)
        },
    )
}

fn finding(
    severity: FindingSeverity,
    code: FindingCode,
    message: String,
    node_id: Option<&str>,
    path: impl Into<String>,
) -> VerificationFinding {
    VerificationFinding {
        severity,
        code,
        message,
        node_id: node_id.map(str::to_owned),
        path: path.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_json_pointer, resource_matches, tool_matches};

    #[test]
    fn exact_and_namespace_tool_patterns_are_segment_aware() {
        assert!(tool_matches("files.read", "files.read"));
        assert!(tool_matches("files.*", "files.read"));
        assert!(!tool_matches("files.*", "files"));
        assert!(!tool_matches("files.*", "filesystem.read"));
    }

    #[test]
    fn resource_prefixes_are_path_segment_aware() {
        assert!(resource_matches("space://alpha/*", "space://alpha/docs"));
        assert!(!resource_matches(
            "space://alpha/*",
            "space://alphabet/docs"
        ));
        assert!(!resource_matches("space://alpha/*", "space://alpha"));
    }

    #[test]
    fn json_pointer_decoding_is_strict() {
        assert_eq!(
            parse_json_pointer("/a~1b/~0c").ok(),
            Some(vec!["a/b".to_owned(), "~c".to_owned()])
        );
        assert!(parse_json_pointer("a").is_err());
        assert!(parse_json_pointer("/~2").is_err());
    }
}
