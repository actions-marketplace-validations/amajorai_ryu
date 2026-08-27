use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The four configuration layers shown in Gateway settings, ordered from the
/// node-wide fallback to the current user's most-specific override.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GovernanceScope {
    Node,
    Organization,
    Team,
    User,
}

/// One optional field value contributed by a governance layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopedValue<T> {
    pub scope: GovernanceScope,
    pub value: Option<T>,
}

impl<T> ScopedValue<T> {
    pub fn new(scope: GovernanceScope, value: Option<T>) -> Self {
        Self { scope, value }
    }
}

/// A resolved field together with the layer that supplied it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedValue<T> {
    pub source: GovernanceScope,
    pub value: T,
}

/// Resolve one field from broadest to most specific. `None` means inherit;
/// `Some(false)` remains a declared value and therefore wins normally.
pub fn resolve_field<T>(
    layers: impl IntoIterator<Item = ScopedValue<T>>,
) -> Option<ResolvedValue<T>> {
    layers.into_iter().fold(None, |resolved, layer| {
        layer.value.map_or(resolved, |value| {
            Some(ResolvedValue {
                source: layer.scope,
                value,
            })
        })
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitMergeMethod {
    Merge,
    Squash,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewDelivery {
    Inline,
    Detached,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct HookPolicyOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trusted: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_prefix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merge_method: Option<GitMergeMethod>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub always_force_push: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub create_draft_pull_requests: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_delivery: Option<ReviewDelivery>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_merge_when_ready: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub watch_instructions: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit_instructions: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pull_request_instructions: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fetch_upstream: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_delete: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_delete_limit: Option<u16>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayGovernanceValues {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub hooks: BTreeMap<String, HookPolicyOverride>,
    #[serde(default)]
    pub git: GitSettings,
    #[serde(default)]
    pub worktrees: WorktreeSettings,
}

fn overlay_option<T: Clone>(target: &mut Option<T>, incoming: &Option<T>) {
    if let Some(value) = incoming {
        *target = Some(value.clone());
    }
}

fn overlay_values(target: &mut GatewayGovernanceValues, incoming: &GatewayGovernanceValues) {
    for (hook_key, hook_override) in &incoming.hooks {
        let target_override = target.hooks.entry(hook_key.clone()).or_default();
        overlay_option(&mut target_override.enabled, &hook_override.enabled);
        overlay_option(&mut target_override.trusted, &hook_override.trusted);
    }

    overlay_option(&mut target.git.branch_prefix, &incoming.git.branch_prefix);
    overlay_option(&mut target.git.merge_method, &incoming.git.merge_method);
    overlay_option(
        &mut target.git.always_force_push,
        &incoming.git.always_force_push,
    );
    overlay_option(
        &mut target.git.create_draft_pull_requests,
        &incoming.git.create_draft_pull_requests,
    );
    overlay_option(
        &mut target.git.review_delivery,
        &incoming.git.review_delivery,
    );
    overlay_option(
        &mut target.git.auto_merge_when_ready,
        &incoming.git.auto_merge_when_ready,
    );
    overlay_option(
        &mut target.git.watch_instructions,
        &incoming.git.watch_instructions,
    );
    overlay_option(
        &mut target.git.commit_instructions,
        &incoming.git.commit_instructions,
    );
    overlay_option(
        &mut target.git.pull_request_instructions,
        &incoming.git.pull_request_instructions,
    );

    overlay_option(&mut target.worktrees.root, &incoming.worktrees.root);
    overlay_option(
        &mut target.worktrees.fetch_upstream,
        &incoming.worktrees.fetch_upstream,
    );
    overlay_option(
        &mut target.worktrees.auto_delete,
        &incoming.worktrees.auto_delete,
    );
    overlay_option(
        &mut target.worktrees.auto_delete_limit,
        &incoming.worktrees.auto_delete_limit,
    );
}

pub fn merge_governance_layers(
    node: &GatewayGovernanceValues,
    organization: Option<&GatewayGovernanceValues>,
    team: Option<&GatewayGovernanceValues>,
    user: Option<&GatewayGovernanceValues>,
) -> GatewayGovernanceValues {
    let mut effective = node.clone();
    for layer in [organization, team, user].into_iter().flatten() {
        overlay_values(&mut effective, layer);
    }
    effective
}

pub fn validate_governance_values(
    scope: GovernanceScope,
    values: &GatewayGovernanceValues,
) -> Result<(), String> {
    if scope != GovernanceScope::Node && values.worktrees.root.is_some() {
        return Err("worktree root is node-only".to_owned());
    }
    if let Some(prefix) = values.git.branch_prefix.as_deref() {
        if prefix.len() > 80 || prefix.chars().any(char::is_whitespace) || prefix.contains("..") {
            return Err(
                "branch prefix must be at most 80 characters with no whitespace or '..'".to_owned(),
            );
        }
    }
    if let Some(limit) = values.worktrees.auto_delete_limit {
        if !(1..=100).contains(&limit) {
            return Err("worktree auto-delete limit must be between 1 and 100".to_owned());
        }
    }
    for hook_key in values.hooks.keys() {
        if hook_key.trim().is_empty() || hook_key.len() > 512 {
            return Err("hook keys must be between 1 and 512 characters".to_owned());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        merge_governance_layers, resolve_field, validate_governance_values,
        GatewayGovernanceValues, GitSettings, GovernanceScope, ScopedValue, WorktreeSettings,
    };

    #[test]
    fn explicit_false_at_user_scope_beats_broader_true() {
        let resolved = resolve_field([
            ScopedValue::new(GovernanceScope::Node, Some(true)),
            ScopedValue::new(GovernanceScope::Organization, Some(true)),
            ScopedValue::new(GovernanceScope::Team, None),
            ScopedValue::new(GovernanceScope::User, Some(false)),
        ])
        .expect("a user override resolves");

        assert!(!resolved.value);
        assert_eq!(resolved.source, GovernanceScope::User);
    }

    #[test]
    fn absent_specific_values_inherit_the_broadest_declared_value() {
        let resolved = resolve_field([
            ScopedValue::new(GovernanceScope::Node, Some("node/")),
            ScopedValue::new(GovernanceScope::Organization, Some("org/")),
            ScopedValue::new(GovernanceScope::Team, None),
            ScopedValue::new(GovernanceScope::User, None),
        ])
        .expect("an organization value resolves");

        assert_eq!(resolved.value, "org/");
        assert_eq!(resolved.source, GovernanceScope::Organization);
    }

    #[test]
    fn field_level_merge_keeps_unrelated_team_and_user_choices() {
        let node = GatewayGovernanceValues {
            git: GitSettings {
                branch_prefix: Some("node/".to_owned()),
                create_draft_pull_requests: Some(false),
                ..GitSettings::default()
            },
            worktrees: WorktreeSettings {
                auto_delete: Some(false),
                auto_delete_limit: Some(15),
                ..WorktreeSettings::default()
            },
            ..GatewayGovernanceValues::default()
        };
        let organization = GatewayGovernanceValues {
            git: GitSettings {
                create_draft_pull_requests: Some(true),
                ..GitSettings::default()
            },
            ..GatewayGovernanceValues::default()
        };
        let team = GatewayGovernanceValues {
            git: GitSettings {
                branch_prefix: Some("team/".to_owned()),
                ..GitSettings::default()
            },
            worktrees: WorktreeSettings {
                auto_delete: Some(true),
                ..WorktreeSettings::default()
            },
            ..GatewayGovernanceValues::default()
        };
        let user = GatewayGovernanceValues {
            git: GitSettings {
                create_draft_pull_requests: Some(false),
                ..GitSettings::default()
            },
            ..GatewayGovernanceValues::default()
        };

        let effective =
            merge_governance_layers(&node, Some(&organization), Some(&team), Some(&user));

        assert_eq!(effective.git.branch_prefix.as_deref(), Some("team/"));
        assert_eq!(effective.git.create_draft_pull_requests, Some(false));
        assert_eq!(effective.worktrees.auto_delete, Some(true));
        assert_eq!(effective.worktrees.auto_delete_limit, Some(15));
    }

    #[test]
    fn managed_layers_cannot_distribute_a_worktree_root() {
        let values = GatewayGovernanceValues {
            worktrees: WorktreeSettings {
                root: Some("/srv/shared".to_owned()),
                ..WorktreeSettings::default()
            },
            ..GatewayGovernanceValues::default()
        };

        let error = validate_governance_values(GovernanceScope::Organization, &values)
            .expect_err("managed absolute roots are node-local");

        assert_eq!(error, "worktree root is node-only");
    }
}
