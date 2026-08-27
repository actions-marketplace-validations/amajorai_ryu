use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub const TOOL_PLAN_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolPlan {
    pub schema_version: u32,
    pub root: PlanNode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PlanNode {
    Call {
        id: String,
        tool: String,
        arguments: PlanValue,
    },
    Sequence {
        id: String,
        nodes: Vec<PlanNode>,
    },
    Parallel {
        id: String,
        nodes: Vec<PlanNode>,
    },
    If {
        id: String,
        predicate: Predicate,
        then_node: Box<PlanNode>,
        else_node: Box<PlanNode>,
    },
}

impl PlanNode {
    #[must_use]
    pub fn id(&self) -> &str {
        match self {
            Self::Call { id, .. }
            | Self::Sequence { id, .. }
            | Self::Parallel { id, .. }
            | Self::If { id, .. } => id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PlanValue {
    Literal {
        value: Value,
    },
    Object {
        fields: BTreeMap<String, PlanValue>,
    },
    Array {
        items: Vec<PlanValue>,
    },
    StepOutput {
        step_id: String,
        #[serde(default)]
        pointer: String,
        value_type: JsonType,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Predicate {
    Compare {
        left: PlanValue,
        op: ComparisonOp,
        right: PlanValue,
    },
    All {
        predicates: Vec<Predicate>,
    },
    Any {
        predicates: Vec<Predicate>,
    },
    Not {
        predicate: Box<Predicate>,
    },
    Exists {
        value: PlanValue,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComparisonOp {
    Equal,
    NotEqual,
    LessThan,
    LessThanOrEqual,
    GreaterThan,
    GreaterThanOrEqual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JsonType {
    Null,
    Boolean,
    Number,
    Integer,
    String,
    Array,
    Object,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EffectKind {
    Read,
    Write,
    Delete,
    Communicate,
    Spend,
    Network,
    Execute,
}

impl EffectKind {
    #[must_use]
    pub fn is_read_only(self) -> bool {
        matches!(self, Self::Read)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContractTrust {
    CoreAttested,
    ManifestAttested,
    OperatorAttested,
    Untrusted,
}

impl ContractTrust {
    #[must_use]
    pub fn is_verifiable(self) -> bool {
        matches!(
            self,
            Self::CoreAttested | Self::ManifestAttested | Self::OperatorAttested
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceBinding {
    /// RFC 6901 pointer into the call arguments. Schema v1 accepts only a
    /// literal string at the selected location; dynamic step outputs fail
    /// closed because their concrete authority cannot be proved in advance.
    pub pointer: String,
    /// Attested namespace prepended to the selected value, for example
    /// `filesystem:` or `slack:channel/`.
    pub prefix: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EffectContract {
    pub trust: ContractTrust,
    /// Empty effect sets are invalid: absence is not evidence of purity.
    pub effects: BTreeSet<EffectKind>,
    /// Argument-independent resource identifiers affected by every invocation.
    pub resources: BTreeSet<String>,
    /// Argument selectors that derive additional concrete resources from this
    /// invocation. The derived values, not friendly static labels, are checked
    /// against policy and bound into the catalog/plan certificate.
    #[serde(default)]
    pub resource_bindings: Vec<ResourceBinding>,
    /// Explicit attestation that this tool's affected resources do not vary
    /// with its arguments. Mutually exclusive with `resource_bindings`.
    #[serde(default)]
    pub arguments_independent: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolDescriptor {
    pub name: String,
    pub input_schema: Value,
    pub output_schema: Value,
    /// Digest of the registry descriptor, dispatch chain, and Core ABI version.
    /// Contracts are accepted only for the implementation revision they attest.
    pub implementation_hash: String,
    /// Canonical registry aliases resolved from the public tool id to its backend.
    #[serde(default)]
    pub dispatch_chain: Vec<String>,
    /// Missing contracts fail closed.
    pub contract: Option<EffectContract>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyLimits {
    pub max_plan_bytes: usize,
    pub max_nodes: usize,
    pub max_depth: usize,
}

impl Default for PolicyLimits {
    fn default() -> Self {
        Self {
            max_plan_bytes: 64 * 1024,
            max_nodes: 128,
            max_depth: 16,
        }
    }
}

/// A default-deny policy.
///
/// Tool patterns are exact names or a namespace prefix ending in `.*`.
/// Resource patterns are exact identifiers or a prefix ending in `/*`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    #[serde(default)]
    pub allow_tools: BTreeSet<String>,
    #[serde(default)]
    pub deny_tools: BTreeSet<String>,
    #[serde(default)]
    pub allowed_effects: BTreeSet<EffectKind>,
    #[serde(default)]
    pub allowed_resources: BTreeSet<String>,
    #[serde(default)]
    pub review_tools: BTreeSet<String>,
    #[serde(default)]
    pub review_effects: BTreeSet<EffectKind>,
    #[serde(default)]
    pub allow_parallel_reads: bool,
    #[serde(default)]
    pub limits: PolicyLimits,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            allow_tools: BTreeSet::new(),
            deny_tools: BTreeSet::new(),
            allowed_effects: BTreeSet::new(),
            allowed_resources: BTreeSet::new(),
            review_tools: BTreeSet::new(),
            review_effects: BTreeSet::new(),
            allow_parallel_reads: false,
            limits: PolicyLimits::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerifierInput {
    pub plan: ToolPlan,
    pub policy: Policy,
    /// Catalog order is not significant; verification and hashing sort by name.
    pub catalog: Vec<ToolDescriptor>,
    pub agent_revision: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationDecision {
    Proved,
    NeedsReview,
    Denied,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingSeverity {
    Error,
    Review,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingCode {
    UnsupportedSchemaVersion,
    PlanTooLarge,
    TooManyNodes,
    PlanTooDeep,
    EmptyPlan,
    InvalidNodeId,
    DuplicateNodeId,
    InvalidToolName,
    InvalidToolPattern,
    InvalidResourcePattern,
    InvalidPolicyLimits,
    PolicyTooComplex,
    CatalogTooLarge,
    DuplicateToolDescriptor,
    UnknownTool,
    MissingEffectContract,
    UntrustedEffectContract,
    MissingEffects,
    MissingResources,
    MissingResourceBindings,
    InvalidResourceBinding,
    UnresolvedResourceBinding,
    InvalidResource,
    UnsupportedToolSchema,
    ToolDenied,
    ToolNotAllowed,
    EffectNotAllowed,
    ResourceNotAllowed,
    ReviewRequired,
    ParallelDisabled,
    ParallelMutation,
    InvalidReference,
    ReferenceNotDominating,
    InvalidJsonPointer,
    OutputPointerMismatch,
    TypeMismatch,
    InvalidPredicate,
    InputShapeMismatch,
    InternalCanonicalization,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerificationFinding {
    pub severity: FindingSeverity,
    pub code: FindingCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Counterexample {
    pub node_id: String,
    pub tool: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effect: Option<EffectKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerificationBindings {
    pub plan_hash: String,
    pub policy_hash: String,
    pub catalog_hash: String,
    pub agent_revision: String,
    pub verifier_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerificationReport {
    pub decision: VerificationDecision,
    pub bindings: VerificationBindings,
    pub findings: Vec<VerificationFinding>,
    pub counterexamples: Vec<Counterexample>,
    /// Canonical hash of every call's typed argument expression, keyed by
    /// unique plan-node id. Reviewers can compare exact evidence without Core
    /// exposing materialized tool outputs before execution.
    #[serde(default)]
    pub argument_hashes: BTreeMap<String, String>,
    /// Exact concrete resources proved for each call after applying its
    /// attested argument selectors.
    #[serde(default)]
    pub invocation_resources: BTreeMap<String, BTreeSet<String>>,
    pub node_count: usize,
    pub max_depth: usize,
    pub canonical_plan_bytes: usize,
}
