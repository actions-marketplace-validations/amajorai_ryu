//! Core-side typed HTTP client for the out-of-process `ryu-teams` sidecar.
//!
//! Agent **teams** used to live in an in-process [`ryu_teams::TeamStore`] that the
//! `@team` chat orchestration, the `agent_builder__create_agent_team` MCP tool, and
//! the `/api/teams/*` CRUD surface all shared. Teams is now an out-of-process app
//! (`@ryu/teams`): the `ryu-teams` sidecar owns `teams.db` and serves
//! `/api/teams/*`, which Core exposes verbatim through the generic ext-proxy
//! `public_mount`. Core's remaining reverse-couplings (the two chat reads +
//! `create_agent_team`) reach the store over loopback HTTP through this client
//! instead of opening the DB, so there is a SINGLE owner of `teams.db`.
//!
//! Security mirrors the ext-proxy hop exactly: loopback target on the sidecar's
//! declared port ([`crate::profile::port`]-shifted for dev profiles), with the
//! per-plugin minted bearer ([`crate::sidecar::ext_proxy::ext_token`]) the sidecar
//! was spawned with — nothing hardcoded.

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use ryu_teams::{CreateTeam, TeamRecord};

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
    /// members). `CreateTeam` is serialized field-by-field so the crate struct needs
    /// no `Serialize` derive.
    pub async fn create(&self, input: CreateTeam) -> Result<TeamRecord> {
        let body = serde_json::json!({
            "name": input.name,
            "description": input.description,
            "members": input.members,
            "coordination": input.coordination,
            "lead_agent_id": input.lead_agent_id,
        });
        let resp = reqwest::Client::new()
            .post(self.base_url())
            .bearer_auth(self.bearer())
            .json(&body)
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
/// Prod uses [`TeamsClient`] (loopback HTTP to the sidecar); tests impl it for
/// [`ryu_teams::TeamStore`] (an in-memory store) so the roster-minting logic stays
/// unit-testable without a live sidecar.
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

#[async_trait]
impl TeamSink for ryu_teams::TeamStore {
    async fn create_team(&self, input: CreateTeam) -> Result<TeamRecord> {
        self.create(input).await
    }
}
