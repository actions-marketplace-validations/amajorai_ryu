use ryu_safe_actions::{
    issue_certificate, sha256_canonical, validate_certificate, validate_runtime_value, verify,
    CertificateBindings, CertificateError, ComparisonOp, ContractTrust, EffectContract, EffectKind,
    FindingCode, JsonType, PlanNode, PlanValue, Policy, PolicyLimits, Predicate, ResourceBinding,
    ToolDescriptor, ToolPlan, VerificationDecision, VerifierInput, TOOL_PLAN_SCHEMA_VERSION,
};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

fn set<T: Ord>(items: impl IntoIterator<Item = T>) -> BTreeSet<T> {
    items.into_iter().collect()
}

fn literal(value: Value) -> PlanValue {
    PlanValue::Literal { value }
}

fn object(fields: impl IntoIterator<Item = (&'static str, PlanValue)>) -> PlanValue {
    PlanValue::Object {
        fields: fields
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    }
}

fn reference(step_id: &str, pointer: &str, value_type: JsonType) -> PlanValue {
    PlanValue::StepOutput {
        step_id: step_id.to_owned(),
        pointer: pointer.to_owned(),
        value_type,
    }
}

fn call(id: &str, tool: &str, arguments: PlanValue) -> PlanNode {
    PlanNode::Call {
        id: id.to_owned(),
        tool: tool.to_owned(),
        arguments,
    }
}

fn descriptor(
    name: &str,
    effects: impl IntoIterator<Item = EffectKind>,
    trust: ContractTrust,
) -> ToolDescriptor {
    ToolDescriptor {
        name: name.to_owned(),
        input_schema: json!({
            "type": "object",
            "properties": { "value": { "type": "string" } },
            "required": ["value"],
            "additionalProperties": false
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "name": { "type": "string" },
                "count": { "type": "integer" }
            },
            "additionalProperties": false
        }),
        implementation_hash: format!("implementation:{name}"),
        dispatch_chain: vec![name.to_owned()],
        contract: Some(EffectContract {
            trust,
            effects: set(effects),
            resources: set(["space://alpha/docs".to_owned()]),
            resource_bindings: Vec::new(),
            arguments_independent: true,
        }),
    }
}

fn policy(tools: impl IntoIterator<Item = &'static str>) -> Policy {
    Policy {
        allow_tools: tools.into_iter().map(str::to_owned).collect(),
        deny_tools: BTreeSet::new(),
        allowed_effects: set([EffectKind::Read, EffectKind::Write]),
        allowed_resources: set(["space://alpha/*".to_owned()]),
        review_tools: BTreeSet::new(),
        review_effects: BTreeSet::new(),
        allow_parallel_reads: true,
        limits: PolicyLimits::default(),
    }
}

fn simple_plan(tool: &str) -> ToolPlan {
    ToolPlan {
        schema_version: TOOL_PLAN_SCHEMA_VERSION,
        root: call("read", tool, object([("value", literal(json!("hello")))])),
    }
}

fn input(plan: ToolPlan, policy: Policy, catalog: Vec<ToolDescriptor>) -> VerifierInput {
    VerifierInput {
        plan,
        policy,
        catalog,
        agent_revision: "agent-rev-7".to_owned(),
    }
}

fn codes(input: &VerifierInput) -> Vec<FindingCode> {
    verify(input)
        .findings
        .into_iter()
        .map(|finding| finding.code)
        .collect()
}

#[test]
fn serde_round_trip_keeps_v1_tagged_schema_stable() {
    let plan = ToolPlan {
        schema_version: TOOL_PLAN_SCHEMA_VERSION,
        root: PlanNode::If {
            id: "choice".to_owned(),
            predicate: Predicate::All {
                predicates: vec![Predicate::Not {
                    predicate: Box::new(Predicate::Compare {
                        left: literal(json!(1)),
                        op: ComparisonOp::LessThan,
                        right: literal(json!(2)),
                    }),
                }],
            },
            then_node: Box::new(call(
                "then",
                "files.read",
                object([("value", literal(json!("a")))]),
            )),
            else_node: Box::new(PlanNode::Parallel {
                id: "parallel".to_owned(),
                nodes: vec![call(
                    "else",
                    "files.read",
                    PlanValue::Array {
                        items: vec![reference("then", "/name", JsonType::String)],
                    },
                )],
            }),
        },
    };
    let encoded = serde_json::to_value(&plan).expect("plan serializes");
    assert_eq!(encoded["schema_version"], json!(1));
    assert_eq!(encoded["root"]["kind"], json!("if"));
    assert_eq!(encoded["root"]["predicate"]["kind"], json!("all"));
    assert_eq!(
        encoded["root"]["else_node"]["nodes"][0]["arguments"]["kind"],
        json!("array")
    );
    let decoded: ToolPlan = serde_json::from_value(encoded.clone()).expect("plan deserializes");
    assert_eq!(decoded, plan);

    let mut with_unknown = encoded.clone();
    with_unknown
        .as_object_mut()
        .expect("object")
        .insert("future_field".to_owned(), json!(true));
    assert!(serde_json::from_value::<ToolPlan>(with_unknown).is_err());

    let mut nested_unknown = encoded;
    nested_unknown["root"]["future_field"] = json!(true);
    assert!(serde_json::from_value::<ToolPlan>(nested_unknown).is_err());
}

#[test]
fn empty_plans_fail_closed() {
    let plan = ToolPlan {
        schema_version: TOOL_PLAN_SCHEMA_VERSION,
        root: PlanNode::Sequence {
            id: "empty".to_owned(),
            nodes: Vec::new(),
        },
    };
    assert!(codes(&input(plan, Policy::default(), Vec::new())).contains(&FindingCode::EmptyPlan));
}

#[test]
fn canonical_hash_sorts_objects_but_preserves_array_order() {
    let mut first = Map::new();
    first.insert("z".to_owned(), json!({ "b": 2, "a": 1 }));
    first.insert("a".to_owned(), json!([1, 2]));
    let mut second = Map::new();
    second.insert("a".to_owned(), json!([1, 2]));
    let mut nested = Map::new();
    nested.insert("a".to_owned(), json!(1));
    nested.insert("b".to_owned(), json!(2));
    second.insert("z".to_owned(), Value::Object(nested));
    assert_eq!(
        sha256_canonical(&Value::Object(first)).expect("hash"),
        sha256_canonical(&Value::Object(second)).expect("hash")
    );
    assert_ne!(
        sha256_canonical(&json!([1, 2])).expect("hash"),
        sha256_canonical(&json!([2, 1])).expect("hash")
    );
}

#[test]
fn catalog_hash_is_independent_of_descriptor_order() {
    let read = descriptor(
        "files.read",
        [EffectKind::Read],
        ContractTrust::CoreAttested,
    );
    let list = descriptor(
        "files.list",
        [EffectKind::Read],
        ContractTrust::ManifestAttested,
    );
    let plan = simple_plan("files.read");
    let policy = policy(["files.*"]);
    let first = verify(&input(
        plan.clone(),
        policy.clone(),
        vec![read.clone(), list.clone()],
    ));
    let second = verify(&input(plan, policy, vec![list, read]));
    assert_eq!(first.bindings.catalog_hash, second.bindings.catalog_hash);
}

#[test]
fn supported_plan_can_be_proved() {
    let verifier_input = input(
        simple_plan("files.read"),
        policy(["files.*"]),
        vec![descriptor(
            "files.read",
            [EffectKind::Read],
            ContractTrust::CoreAttested,
        )],
    );
    let report = verify(&verifier_input);
    assert_eq!(report.decision, VerificationDecision::Proved);
    assert!(report.findings.is_empty());
    assert_eq!(report.node_count, 1);
}

#[test]
fn unsupported_schema_and_all_three_limits_fail_closed() {
    let mut plan = ToolPlan {
        schema_version: 99,
        root: PlanNode::Sequence {
            id: "root".to_owned(),
            nodes: vec![call(
                "read",
                "files.read",
                object([("value", literal(json!("a long enough value")))]),
            )],
        },
    };
    let mut limited_policy = policy(["files.read"]);
    limited_policy.limits = PolicyLimits {
        max_plan_bytes: 1,
        max_nodes: 1,
        max_depth: 1,
    };
    let verifier_input = input(
        plan.clone(),
        limited_policy,
        vec![descriptor(
            "files.read",
            [EffectKind::Read],
            ContractTrust::CoreAttested,
        )],
    );
    let found = codes(&verifier_input);
    assert!(found.contains(&FindingCode::UnsupportedSchemaVersion));
    assert!(found.contains(&FindingCode::PlanTooLarge));
    assert!(found.contains(&FindingCode::TooManyNodes));
    assert!(found.contains(&FindingCode::PlanTooDeep));

    plan.schema_version = TOOL_PLAN_SCHEMA_VERSION;
    let mut invalid_limits = policy(["files.read"]);
    invalid_limits.limits.max_nodes = 0;
    assert!(codes(&input(plan, invalid_limits, verifier_input.catalog))
        .contains(&FindingCode::InvalidPolicyLimits));
}

#[test]
fn duplicate_node_ids_and_catalog_names_are_rejected() {
    let plan = ToolPlan {
        schema_version: TOOL_PLAN_SCHEMA_VERSION,
        root: PlanNode::Sequence {
            id: "root".to_owned(),
            nodes: vec![
                call(
                    "same",
                    "files.read",
                    object([("value", literal(json!("a")))]),
                ),
                call(
                    "same",
                    "files.read",
                    object([("value", literal(json!("b")))]),
                ),
            ],
        },
    };
    let descriptor = descriptor(
        "files.read",
        [EffectKind::Read],
        ContractTrust::CoreAttested,
    );
    let found = codes(&input(
        plan,
        policy(["files.read"]),
        vec![descriptor.clone(), descriptor],
    ));
    assert!(found.contains(&FindingCode::DuplicateNodeId));
    assert!(found.contains(&FindingCode::DuplicateToolDescriptor));
}

#[test]
fn forward_reference_is_not_dominating() {
    let plan = ToolPlan {
        schema_version: TOOL_PLAN_SCHEMA_VERSION,
        root: PlanNode::Sequence {
            id: "root".to_owned(),
            nodes: vec![
                call(
                    "consumer",
                    "files.read",
                    object([("value", reference("future", "/name", JsonType::String))]),
                ),
                call(
                    "future",
                    "files.read",
                    object([("value", literal(json!("later")))]),
                ),
            ],
        },
    };
    assert!(codes(&input(
        plan,
        policy(["files.read"]),
        vec![descriptor(
            "files.read",
            [EffectKind::Read],
            ContractTrust::CoreAttested
        )],
    ))
    .contains(&FindingCode::ReferenceNotDominating));
}

#[test]
fn cross_branch_and_post_branch_references_are_not_dominating() {
    let conditional = PlanNode::If {
        id: "choice".to_owned(),
        predicate: Predicate::Exists {
            value: literal(json!(true)),
        },
        then_node: Box::new(call(
            "then_step",
            "files.read",
            object([("value", reference("else_step", "/name", JsonType::String))]),
        )),
        else_node: Box::new(call(
            "else_step",
            "files.read",
            object([("value", literal(json!("else")))]),
        )),
    };
    let plan = ToolPlan {
        schema_version: TOOL_PLAN_SCHEMA_VERSION,
        root: PlanNode::Sequence {
            id: "root".to_owned(),
            nodes: vec![
                conditional,
                call(
                    "after",
                    "files.read",
                    object([("value", reference("then_step", "/name", JsonType::String))]),
                ),
            ],
        },
    };
    let report = verify(&input(
        plan,
        policy(["files.read"]),
        vec![descriptor(
            "files.read",
            [EffectKind::Read],
            ContractTrust::CoreAttested,
        )],
    ));
    assert_eq!(
        report
            .findings
            .iter()
            .filter(|item| item.code == FindingCode::ReferenceNotDominating)
            .count(),
        2
    );
}

#[test]
fn parallel_siblings_cannot_reference_each_other() {
    let plan = ToolPlan {
        schema_version: TOOL_PLAN_SCHEMA_VERSION,
        root: PlanNode::Parallel {
            id: "parallel".to_owned(),
            nodes: vec![
                call(
                    "first",
                    "files.read",
                    object([("value", reference("second", "/name", JsonType::String))]),
                ),
                call(
                    "second",
                    "files.read",
                    object([("value", literal(json!("second")))]),
                ),
            ],
        },
    };
    assert!(codes(&input(
        plan,
        policy(["files.read"]),
        vec![descriptor(
            "files.read",
            [EffectKind::Read],
            ContractTrust::CoreAttested
        )],
    ))
    .contains(&FindingCode::ReferenceNotDominating));
}

#[test]
fn json_pointer_and_static_types_are_checked() {
    let descriptor = descriptor(
        "files.read",
        [EffectKind::Read],
        ContractTrust::CoreAttested,
    );
    let make_plan = |pointer: &str, value_type: JsonType| ToolPlan {
        schema_version: TOOL_PLAN_SCHEMA_VERSION,
        root: PlanNode::Sequence {
            id: "root".to_owned(),
            nodes: vec![
                call(
                    "source",
                    "files.read",
                    object([("value", literal(json!("source")))]),
                ),
                call(
                    "consumer",
                    "files.read",
                    object([("value", reference("source", pointer, value_type))]),
                ),
            ],
        },
    };
    let invalid_syntax = codes(&input(
        make_plan("name", JsonType::String),
        policy(["files.read"]),
        vec![descriptor.clone()],
    ));
    assert!(invalid_syntax.contains(&FindingCode::InvalidJsonPointer));

    let missing_property = codes(&input(
        make_plan("/missing", JsonType::String),
        policy(["files.read"]),
        vec![descriptor.clone()],
    ));
    assert!(missing_property.contains(&FindingCode::OutputPointerMismatch));

    let wrong_declared_type = codes(&input(
        make_plan("/count", JsonType::String),
        policy(["files.read"]),
        vec![descriptor.clone()],
    ));
    assert!(wrong_declared_type.contains(&FindingCode::TypeMismatch));

    let wrong_input_type = codes(&input(
        make_plan("/count", JsonType::Integer),
        policy(["files.read"]),
        vec![descriptor],
    ));
    assert!(wrong_input_type.contains(&FindingCode::TypeMismatch));
}

#[test]
fn integer_schemas_reject_floating_values() {
    let mut integer_tool = descriptor(
        "numbers.store",
        [EffectKind::Write],
        ContractTrust::OperatorAttested,
    );
    integer_tool.input_schema = json!({
        "type": "object",
        "properties": { "value": { "type": "integer" } },
        "required": ["value"],
        "additionalProperties": false
    });
    let plan = ToolPlan {
        schema_version: TOOL_PLAN_SCHEMA_VERSION,
        root: call(
            "store",
            "numbers.store",
            object([("value", literal(json!(1.5)))]),
        ),
    };
    assert!(
        codes(&input(plan, policy(["numbers.store"]), vec![integer_tool]))
            .contains(&FindingCode::TypeMismatch)
    );
}

#[test]
fn malformed_false_and_unsupported_schemas_fail_closed() {
    let mut malformed = descriptor(
        "files.read",
        [EffectKind::Read],
        ContractTrust::CoreAttested,
    );
    malformed.input_schema = json!({"type": "mystery"});
    let mut false_schema = malformed.clone();
    false_schema.name = "files.false".to_owned();
    false_schema.input_schema = Value::Bool(false);
    let mut unsupported = malformed.clone();
    unsupported.name = "files.pattern".to_owned();
    unsupported.input_schema = json!({"type": "string", "pattern": "^safe$"});

    for descriptor in [malformed, false_schema, unsupported] {
        let tool = descriptor.name.clone();
        let report = verify(&input(
            simple_plan(&tool),
            policy(["files.*"]),
            vec![descriptor],
        ));
        assert_eq!(report.decision, VerificationDecision::Denied);
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.code == FindingCode::UnsupportedToolSchema));
    }
}

#[test]
fn floating_point_ordering_is_not_certifiable() {
    let plan = ToolPlan {
        schema_version: TOOL_PLAN_SCHEMA_VERSION,
        root: PlanNode::If {
            id: "choice".to_owned(),
            predicate: Predicate::Compare {
                left: literal(json!(1.1)),
                op: ComparisonOp::LessThan,
                right: literal(json!(1.2)),
            },
            then_node: Box::new(call(
                "then",
                "files.read",
                object([("value", literal(json!("then")))]),
            )),
            else_node: Box::new(call(
                "else",
                "files.read",
                object([("value", literal(json!("else")))]),
            )),
        },
    };
    assert!(codes(&input(
        plan,
        policy(["files.read"]),
        vec![descriptor(
            "files.read",
            [EffectKind::Read],
            ContractTrust::CoreAttested,
        )],
    ))
    .contains(&FindingCode::InvalidPredicate));
}

#[test]
fn both_conditional_branches_are_verified() {
    let plan = ToolPlan {
        schema_version: TOOL_PLAN_SCHEMA_VERSION,
        root: PlanNode::If {
            id: "choice".to_owned(),
            predicate: Predicate::Compare {
                left: literal(json!(1)),
                op: ComparisonOp::Equal,
                right: literal(json!(1)),
            },
            then_node: Box::new(call(
                "then",
                "unknown.then",
                object([("value", literal(json!("then")))]),
            )),
            else_node: Box::new(call(
                "else",
                "unknown.else",
                object([("value", literal(json!("else")))]),
            )),
        },
    };
    let report = verify(&input(plan, policy(["unknown.*"]), vec![]));
    assert_eq!(
        report
            .findings
            .iter()
            .filter(|item| item.code == FindingCode::UnknownTool)
            .count(),
        2
    );
}

#[test]
fn parallel_requires_policy_and_proved_read_only_calls() {
    let plan = ToolPlan {
        schema_version: TOOL_PLAN_SCHEMA_VERSION,
        root: PlanNode::Parallel {
            id: "parallel".to_owned(),
            nodes: vec![call(
                "write",
                "files.write",
                object([("value", literal(json!("write")))]),
            )],
        },
    };
    let mut disabled = policy(["files.write"]);
    disabled.allow_parallel_reads = false;
    let report = verify(&input(
        plan,
        disabled,
        vec![descriptor(
            "files.write",
            [EffectKind::Write],
            ContractTrust::OperatorAttested,
        )],
    ));
    assert!(report
        .findings
        .iter()
        .any(|item| item.code == FindingCode::ParallelDisabled));
    assert!(report
        .findings
        .iter()
        .any(|item| item.code == FindingCode::ParallelMutation));
}

#[test]
fn unknown_missing_empty_and_untrusted_effects_fail_closed() {
    let base_plan = simple_plan("files.read");
    let base_policy = policy(["files.read"]);
    assert!(
        codes(&input(base_plan.clone(), base_policy.clone(), vec![]))
            .contains(&FindingCode::UnknownTool)
    );

    let mut missing = descriptor(
        "files.read",
        [EffectKind::Read],
        ContractTrust::CoreAttested,
    );
    missing.contract = None;
    assert!(codes(&input(
        base_plan.clone(),
        base_policy.clone(),
        vec![missing]
    ))
    .contains(&FindingCode::MissingEffectContract));

    let empty = descriptor("files.read", [], ContractTrust::ManifestAttested);
    assert!(
        codes(&input(base_plan.clone(), base_policy.clone(), vec![empty]))
            .contains(&FindingCode::MissingEffects)
    );

    let untrusted = descriptor("files.read", [EffectKind::Read], ContractTrust::Untrusted);
    assert!(codes(&input(base_plan, base_policy, vec![untrusted]))
        .contains(&FindingCode::UntrustedEffectContract));
}

#[test]
fn missing_and_unsafe_resources_fail_closed() {
    let plan = simple_plan("files.read");
    let allowed = policy(["files.read"]);
    let mut missing = descriptor(
        "files.read",
        [EffectKind::Read],
        ContractTrust::CoreAttested,
    );
    missing
        .contract
        .as_mut()
        .expect("contract")
        .resources
        .clear();
    assert!(codes(&input(plan.clone(), allowed.clone(), vec![missing]))
        .contains(&FindingCode::MissingResources));

    let mut unsafe_resource = descriptor(
        "files.read",
        [EffectKind::Read],
        ContractTrust::CoreAttested,
    );
    unsafe_resource
        .contract
        .as_mut()
        .expect("contract")
        .resources = set(["space://alpha/%2e%2e/private".to_owned()]);
    assert!(
        codes(&input(plan, allowed, vec![unsafe_resource])).contains(&FindingCode::InvalidResource)
    );
}

#[test]
fn default_deny_and_explicit_deny_take_precedence() {
    let descriptor = descriptor(
        "files.read",
        [EffectKind::Read],
        ContractTrust::CoreAttested,
    );
    assert!(codes(&input(
        simple_plan("files.read"),
        Policy::default(),
        vec![descriptor.clone()]
    ))
    .contains(&FindingCode::ToolNotAllowed));

    let mut contradictory = policy(["files.*"]);
    contradictory.deny_tools.insert("files.read".to_owned());
    let report = verify(&input(
        simple_plan("files.read"),
        contradictory,
        vec![descriptor],
    ));
    assert!(report
        .findings
        .iter()
        .any(|item| item.code == FindingCode::ToolDenied));
    assert!(report
        .counterexamples
        .iter()
        .any(|item| item.reason.contains("precedence")));
}

#[test]
fn effect_and_resource_mismatches_include_counterexamples() {
    let mut restrictive = policy(["files.read"]);
    restrictive.allowed_effects = set([EffectKind::Read]);
    restrictive.allowed_resources = set(["space://beta/*".to_owned()]);
    let report = verify(&input(
        simple_plan("files.read"),
        restrictive,
        vec![descriptor(
            "files.read",
            [EffectKind::Write],
            ContractTrust::OperatorAttested,
        )],
    ));
    assert!(report
        .findings
        .iter()
        .any(|item| item.code == FindingCode::EffectNotAllowed));
    assert!(report
        .findings
        .iter()
        .any(|item| item.code == FindingCode::ResourceNotAllowed));
    assert!(report
        .counterexamples
        .iter()
        .any(|item| item.effect == Some(EffectKind::Write)));
    assert!(report
        .counterexamples
        .iter()
        .any(|item| item.resource.as_deref() == Some("space://alpha/docs")));
}

#[test]
fn review_rules_produce_needs_review_without_weakening_denials() {
    let mut review = policy(["files.read"]);
    review.review_tools.insert("files.*".to_owned());
    review.review_effects.insert(EffectKind::Read);
    let report = verify(&input(
        simple_plan("files.read"),
        review,
        vec![descriptor(
            "files.read",
            [EffectKind::Read],
            ContractTrust::CoreAttested,
        )],
    ));
    assert_eq!(report.decision, VerificationDecision::NeedsReview);
    assert_eq!(
        report
            .findings
            .iter()
            .filter(|item| item.code == FindingCode::ReviewRequired)
            .count(),
        2
    );
}

#[test]
fn argument_derived_resources_bind_policy_to_the_actual_invocation() {
    let mut tool = descriptor(
        "files.write",
        [EffectKind::Write],
        ContractTrust::OperatorAttested,
    );
    let contract = tool.contract.as_mut().expect("contract");
    contract.arguments_independent = false;
    contract.resources.clear();
    contract.resource_bindings = vec![ResourceBinding {
        pointer: "/value".to_owned(),
        prefix: "space://alpha/".to_owned(),
    }];

    let allowed = verify(&input(
        ToolPlan {
            schema_version: TOOL_PLAN_SCHEMA_VERSION,
            root: call(
                "write",
                "files.write",
                object([("value", literal(json!("docs/report")))]),
            ),
        },
        policy(["files.write"]),
        vec![tool.clone()],
    ));
    assert_eq!(allowed.decision, VerificationDecision::Proved);

    let traversal = verify(&input(
        ToolPlan {
            schema_version: TOOL_PLAN_SCHEMA_VERSION,
            root: call(
                "write",
                "files.write",
                object([("value", literal(json!("../../secret")))]),
            ),
        },
        policy(["files.write"]),
        vec![tool],
    ));
    assert_eq!(traversal.decision, VerificationDecision::Denied);
    assert!(traversal
        .findings
        .iter()
        .any(|finding| finding.code == FindingCode::InvalidResource));
}

#[test]
fn dynamic_resource_bindings_fail_closed_before_execution() {
    let mut write = descriptor(
        "files.write",
        [EffectKind::Write],
        ContractTrust::OperatorAttested,
    );
    let contract = write.contract.as_mut().expect("contract");
    contract.arguments_independent = false;
    contract.resources.clear();
    contract.resource_bindings = vec![ResourceBinding {
        pointer: "/value".to_owned(),
        prefix: "space://alpha/".to_owned(),
    }];
    let report = verify(&input(
        ToolPlan {
            schema_version: TOOL_PLAN_SCHEMA_VERSION,
            root: PlanNode::Sequence {
                id: "root".to_owned(),
                nodes: vec![
                    call(
                        "read",
                        "files.read",
                        object([("value", literal(json!("docs/source")))]),
                    ),
                    call(
                        "write",
                        "files.write",
                        object([("value", reference("read", "/name", JsonType::String))]),
                    ),
                ],
            },
        },
        policy(["files.read", "files.write"]),
        vec![
            descriptor(
                "files.read",
                [EffectKind::Read],
                ContractTrust::CoreAttested,
            ),
            write,
        ],
    ));
    assert_eq!(report.decision, VerificationDecision::Denied);
    assert!(report
        .findings
        .iter()
        .any(|finding| finding.code == FindingCode::UnresolvedResourceBinding));
}

fn proved_report() -> ryu_safe_actions::VerificationReport {
    verify(&input(
        simple_plan("files.read"),
        policy(["files.read"]),
        vec![descriptor(
            "files.read",
            [EffectKind::Read],
            ContractTrust::CoreAttested,
        )],
    ))
}

#[test]
fn certificate_accepts_exact_live_bindings() {
    let report = proved_report();
    let certificate = issue_certificate(&report, 1_000, 2_000).expect("certificate");
    let expected = CertificateBindings::from(&report.bindings);
    assert_eq!(
        validate_certificate(&certificate, &expected, "agent-rev-7", 1_500),
        Ok(())
    );
}

#[test]
fn certificate_rejects_stale_forged_expired_and_wrong_agent_data() {
    let report = proved_report();
    let certificate = issue_certificate(&report, 1_000, 2_000).expect("certificate");
    let expected = CertificateBindings::from(&report.bindings);

    let mut stale = expected.clone();
    stale.plan_hash = "changed-plan".to_owned();
    assert_eq!(
        validate_certificate(&certificate, &stale, "agent-rev-7", 1_500),
        Err(CertificateError::BindingMismatch("plan"))
    );

    let mut forged = certificate.clone();
    forged.data.bindings.policy_hash = "forged-policy".to_owned();
    assert_eq!(
        validate_certificate(&forged, &expected, "agent-rev-7", 1_500),
        Err(CertificateError::IntegrityMismatch)
    );

    assert_eq!(
        validate_certificate(&certificate, &expected, "agent-rev-7", 2_000),
        Err(CertificateError::Expired)
    );
    assert_eq!(
        validate_certificate(&certificate, &expected, "other-agent", 1_500),
        Err(CertificateError::WrongAgent)
    );
}

#[test]
fn certificate_rejects_non_proved_reports_and_invalid_windows() {
    let mut review_policy = policy(["files.read"]);
    review_policy.review_effects.insert(EffectKind::Read);
    let review_report = verify(&input(
        simple_plan("files.read"),
        review_policy,
        vec![descriptor(
            "files.read",
            [EffectKind::Read],
            ContractTrust::CoreAttested,
        )],
    ));
    assert_eq!(
        issue_certificate(&review_report, 1_000, 2_000),
        Err(CertificateError::ReportNotProved)
    );
    assert_eq!(
        issue_certificate(&proved_report(), 2_000, 2_000),
        Err(CertificateError::InvalidValidityWindow)
    );
}

#[test]
fn composite_step_outputs_must_be_structurally_assignable() {
    let mut source = descriptor(
        "records.source",
        [EffectKind::Read],
        ContractTrust::CoreAttested,
    );
    source.output_schema = json!({
        "type": "object",
        "properties": { "x": { "type": "integer" } },
        "required": ["x"],
        "additionalProperties": false
    });
    let mut destination = descriptor(
        "records.destination",
        [EffectKind::Read],
        ContractTrust::CoreAttested,
    );
    destination.input_schema = json!({
        "type": "object",
        "properties": { "recipient": { "type": "string" } },
        "required": ["recipient"],
        "additionalProperties": false
    });
    let report = verify(&input(
        ToolPlan {
            schema_version: TOOL_PLAN_SCHEMA_VERSION,
            root: PlanNode::Sequence {
                id: "root".to_owned(),
                nodes: vec![
                    call(
                        "source",
                        "records.source",
                        object([("value", literal(json!("seed")))]),
                    ),
                    call(
                        "destination",
                        "records.destination",
                        reference("source", "", JsonType::Object),
                    ),
                ],
            },
        },
        policy(["records.source", "records.destination"]),
        vec![source, destination],
    ));

    assert_eq!(report.decision, VerificationDecision::Denied);
    assert!(report
        .findings
        .iter()
        .any(|finding| finding.code == FindingCode::InputShapeMismatch));
}

#[test]
fn runtime_values_use_the_same_recursive_schema_rules() {
    let schema = json!({
        "type": "object",
        "properties": { "recipient": { "type": "string" } },
        "required": ["recipient"],
        "additionalProperties": false
    });

    assert!(validate_runtime_value(&json!({ "recipient": "Ada" }), &schema).is_ok());
    assert!(validate_runtime_value(&json!({ "x": 1 }), &schema).is_err());
    assert!(validate_runtime_value(&json!({ "recipient": 7 }), &schema).is_err());
    assert!(
        validate_runtime_value(&json!({ "recipient": "Ada", "unexpected": true }), &schema)
            .is_err()
    );
}
