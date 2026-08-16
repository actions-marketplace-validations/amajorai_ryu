//! Core-side typed HTTP client for the out-of-process `ryu-teams` sidecar.
//!
//! Agent **teams** used to live in an in-process `ryu_teams::TeamStore` that the
//! `@team` chat orchestration, the `agent_builder__create_agent_team` MCP tool, and
//! the `/api/teams/*` CRUD surface all shared. Teams is now an out-of-process app
//! (`@ryu/teams`): the `ryu-teams` sidecar owns `teams.db` and serves
//! `/api/teams/*`, which Core exposes verbatim through the generic ext-proxy
//! `public_mount`. Core's remaining reverse-couplings (the two chat reads +
//! `create_agent_team`) reach the store over loopback HTTP through this client
//! instead of opening the DB, so there is a SINGLE owner of `teams.db`.
//!
//! Core links **none** of the `ryu-teams` crate. The only Rust the two halves share
//! is the wire contract in [`ryu_teams_contracts`] — three serde shapes and the
//! kebab-case strategy table — which both sides depend on and neither owns.
//!
//! Security mirrors the ext-proxy hop exactly: loopback target on the sidecar's
//! declared port ([`crate::profile::port`]-shifted for dev profiles), with the
//! per-plugin minted bearer ([`crate::sidecar::ext_proxy::ext_token`]) the sidecar
//! was spawned with — nothing hardcoded.

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use ryu_teams_contracts::{CreateTeam, TeamRecord};

use crate::plugins::builtins::TEAMS_PLUGIN_ID;
use crate::sidecar::ext_proxy::{ext_token, node_token};

/// The `ryu-teams` sidecar's name inside the Teams manifest — the other half of the
/// `(plugin id, sidecar name)` key the port resolves through.
const TEAMS_SIDECAR: &str = "ryu-teams";

/// Resolve the `ryu-teams` sidecar's loopback port from the loaded manifests,
/// profile-shifted the same way the ext-proxy forwards (`crate::profile::port`), so
/// dev/custom profiles hit the same shifted port the sidecar was told to bind. The
/// port comes from the manifest and ONLY the manifest — see
/// [`crate::sidecar::ext_proxy::sidecar_port`] for why a built-in absence is a
/// build-time invariant rather than a runtime fallback.
pub fn sidecar_port(manifests: &[crate::plugin_manifest::PluginManifest]) -> u16 {
    crate::sidecar::ext_proxy::sidecar_port(manifests, TEAMS_PLUGIN_ID, TEAMS_SIDECAR).expect(
        "built-in teams.manifest.json must declare the ryu-teams sidecar (see \
         plugin_manifest::BUILTIN_MANIFESTS)",
    )
}

/// Typed loopback client for the `ryu-teams` sidecar. Cheap to clone (holds only the
/// resolved port); the bearer is minted per call so it always tracks the current
/// node token.
#[derive(Clone)]
pub struct TeamsClient {
    port: u16,
}

impl TeamsClient {
    /// Build a client bound to the sidecar's resolved loopback port.
    pub fn new(port: u16) -> Self {
        Self { port }
    }

    fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}/api/teams", self.port)
    }

    /// The per-plugin minted bearer the sidecar was spawned with — the same value
    /// the ext-proxy stamps on its hop, so a hand-rolled local request without it is
    /// rejected fail-closed.
    fn bearer(&self) -> String {
        ext_token(node_token().as_deref(), TEAMS_PLUGIN_ID)
    }

    /// Fetch one team by id. A 404 maps to `Ok(None)` (unknown team), matching the
    /// old `TeamStore::get` contract the chat path consumes.
    pub async fn get(&self, id: &str) -> Result<Option<TeamRecord>> {
        let resp = reqwest::Client::new()
            .get(format!("{}/{id}", self.base_url()))
            .bearer_auth(self.bearer())
            .send()
            .await
            .context("GET /api/teams/:id on the teams sidecar")?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !resp.status().is_success() {
            bail!("teams sidecar GET /{id} returned {}", resp.status());
        }
        let body: serde_json::Value = resp.json().await.context("decoding the team payload")?;
        let team = serde_json::from_value(body["team"].clone())
            .context("parsing TeamRecord from the teams sidecar")?;
        Ok(Some(team))
    }

    /// Create a team (used by `agent_builder__create_agent_team` after minting its
    /// members). The contract struct is posted verbatim — it derives `Serialize`
    /// with no `skip_serializing_if`, so the body is the full five keys the
    /// sidecar's handler reads, and a field added to the contract reaches the
    /// sidecar without anyone remembering to widen a hand-built `json!` here.
    pub async fn create(&self, input: CreateTeam) -> Result<TeamRecord> {
        let resp = reqwest::Client::new()
            .post(self.base_url())
            .bearer_auth(self.bearer())
            .json(&input)
            .send()
            .await
            .context("POST /api/teams on the teams sidecar")?;
        if !resp.status().is_success() {
            bail!("teams sidecar POST /api/teams returned {}", resp.status());
        }
        let body: serde_json::Value = resp.json().await.context("decoding the created team")?;
        serde_json::from_value(body["team"].clone())
            .context("parsing the created TeamRecord from the teams sidecar")
    }
}

/// The team-persistence seam `agent_builder::create_agent_team` writes through.
///
/// Prod uses [`TeamsClient`] (loopback HTTP to the sidecar). Tests supply their own
/// in-memory double (`runnable::agent_builder::tests::FakeTeamSink`) so the
/// roster-minting logic stays unit-testable without a live sidecar — and, since this
/// trait is the whole seam, without Core linking the sidecar crate to borrow its
/// SQLite store. Persistence is the sidecar's own concern and is covered by its
/// `tests/store_behaviors.rs`.
#[async_trait]
pub trait TeamSink: Send + Sync {
    async fn create_team(&self, input: CreateTeam) -> Result<TeamRecord>;
}

#[async_trait]
impl TeamSink for TeamsClient {
    async fn create_team(&self, input: CreateTeam) -> Result<TeamRecord> {
        self.create(input).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The read path crosses from a SEPARATELY-VERSIONED binary (`RYU_TEAMS_BIN` can
    /// point at any build), so a newer sidecar may serve a strategy this build has
    /// never heard of. Before the contract crate this parse was strict and every
    /// `@team` turn for such a team collapsed into "failed to load team"; the
    /// contract's lenient read degrades the one field instead. Pinned here, at the
    /// consumer, because this client is where the break actually surfaced.
    #[test]
    fn an_unknown_strategy_from_a_newer_sidecar_still_parses() {
        let body = serde_json::json!({
            "team": { "id": "t1", "name": "Growth", "members": ["a", "b"], "coordination": "swarm" }
        });
        let team: TeamRecord = serde_json::from_value(body["team"].clone())
            .expect("an unknown strategy must not fail the record");
        assert_eq!(
            team.coordination,
            ryu_teams_contracts::Coordination::Broadcast
        );
        assert_eq!(team.members.len(), 2);
    }

    /// `create` posts the struct verbatim; the sidecar's handler reads these keys.
    #[test]
    fn create_team_body_carries_the_five_keys() {
        let body = serde_json::to_value(CreateTeam {
            name: "Marketing".to_owned(),
            members: vec!["a".to_owned()],
            coordination: ryu_teams_contracts::Coordination::Router,
            ..Default::default()
        })
        .unwrap();
        for key in [
            "name",
            "description",
            "members",
            "coordination",
            "lead_agent_id",
        ] {
            assert!(body.get(key).is_some(), "missing {key} in {body}");
        }
        assert_eq!(body["coordination"], serde_json::json!("router"));
    }
}
