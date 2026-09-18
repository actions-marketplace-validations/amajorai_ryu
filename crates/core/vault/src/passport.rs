//! Structured request-header contract for trusted Passport runtime consumers.
//! Parts are never reparsed as templates: a resolved secret containing `vault:`
//! remains literal secret data, not a new credential reference.
use serde::{Deserialize, Serialize};

/// Deliberately not Debug: Sensitive parts carry caller-owned secret material.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HeaderPart {
    Literal(String),
    Sensitive(String),
    Vault(String),
}
