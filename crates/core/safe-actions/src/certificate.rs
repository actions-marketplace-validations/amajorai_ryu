use crate::{sha256_canonical, VerificationBindings, VerificationDecision, VerificationReport};
use serde::{Deserialize, Serialize};
use std::fmt::{Display, Formatter};

pub const CERTIFICATE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CertificateBindings {
    pub plan_hash: String,
    pub policy_hash: String,
    pub catalog_hash: String,
    pub agent_revision: String,
    pub verifier_version: String,
}

impl From<&VerificationBindings> for CertificateBindings {
    fn from(value: &VerificationBindings) -> Self {
        Self {
            plan_hash: value.plan_hash.clone(),
            policy_hash: value.policy_hash.clone(),
            catalog_hash: value.catalog_hash.clone(),
            agent_revision: value.agent_revision.clone(),
            verifier_version: value.verifier_version.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CertificateData {
    pub schema_version: u32,
    pub bindings: CertificateBindings,
    pub issued_at_unix_ms: u64,
    pub expires_at_unix_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Certificate {
    pub data: CertificateData,
    /// Detects accidental or post-issuance mutation. Core must additionally keep
    /// certificates in trusted storage; this unkeyed digest is not a signature.
    pub integrity_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CertificateError {
    ReportNotProved,
    InvalidValidityWindow,
    UnsupportedSchemaVersion,
    IntegrityMismatch,
    BindingMismatch(&'static str),
    WrongAgent,
    NotYetValid,
    Expired,
    Canonicalization(String),
}

impl Display for CertificateError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ReportNotProved => write!(formatter, "only proved reports can be certified"),
            Self::InvalidValidityWindow => {
                write!(formatter, "certificate expiry must follow issue time")
            }
            Self::UnsupportedSchemaVersion => {
                write!(formatter, "unsupported certificate schema version")
            }
            Self::IntegrityMismatch => write!(
                formatter,
                "certificate integrity hash does not match its data"
            ),
            Self::BindingMismatch(binding) => {
                write!(formatter, "certificate {binding} binding does not match")
            }
            Self::WrongAgent => write!(
                formatter,
                "certificate belongs to a different agent revision"
            ),
            Self::NotYetValid => write!(formatter, "certificate is not valid yet"),
            Self::Expired => write!(formatter, "certificate has expired"),
            Self::Canonicalization(message) => {
                write!(formatter, "certificate canonicalization failed: {message}")
            }
        }
    }
}

impl std::error::Error for CertificateError {}

/// Build certificate data for a proved report.
///
/// The caller is responsible for placing the returned certificate in trusted
/// Core storage. This crate intentionally owns no keys or persistent state.
pub fn issue_certificate(
    report: &VerificationReport,
    issued_at_unix_ms: u64,
    expires_at_unix_ms: u64,
) -> Result<Certificate, CertificateError> {
    if report.decision != VerificationDecision::Proved {
        return Err(CertificateError::ReportNotProved);
    }
    if expires_at_unix_ms <= issued_at_unix_ms {
        return Err(CertificateError::InvalidValidityWindow);
    }
    let data = CertificateData {
        schema_version: CERTIFICATE_SCHEMA_VERSION,
        bindings: CertificateBindings::from(&report.bindings),
        issued_at_unix_ms,
        expires_at_unix_ms,
    };
    let integrity_hash = sha256_canonical(&data)
        .map_err(|error| CertificateError::Canonicalization(error.to_string()))?;
    Ok(Certificate {
        data,
        integrity_hash,
    })
}

/// Validate structural integrity, exact verifier bindings, agent identity, and
/// validity window. No external state is consulted.
pub fn validate_certificate(
    certificate: &Certificate,
    expected: &CertificateBindings,
    expected_agent_revision: &str,
    now_unix_ms: u64,
) -> Result<(), CertificateError> {
    if certificate.data.schema_version != CERTIFICATE_SCHEMA_VERSION {
        return Err(CertificateError::UnsupportedSchemaVersion);
    }
    let computed = sha256_canonical(&certificate.data)
        .map_err(|error| CertificateError::Canonicalization(error.to_string()))?;
    if computed != certificate.integrity_hash {
        return Err(CertificateError::IntegrityMismatch);
    }
    let actual = &certificate.data.bindings;
    if actual.agent_revision != expected_agent_revision {
        return Err(CertificateError::WrongAgent);
    }
    check_binding(&actual.plan_hash, &expected.plan_hash, "plan")?;
    check_binding(&actual.policy_hash, &expected.policy_hash, "policy")?;
    check_binding(&actual.catalog_hash, &expected.catalog_hash, "catalog")?;
    check_binding(
        &actual.verifier_version,
        &expected.verifier_version,
        "verifier version",
    )?;
    if actual.agent_revision != expected.agent_revision {
        return Err(CertificateError::BindingMismatch("agent revision"));
    }
    if certificate.data.expires_at_unix_ms <= certificate.data.issued_at_unix_ms {
        return Err(CertificateError::InvalidValidityWindow);
    }
    if now_unix_ms < certificate.data.issued_at_unix_ms {
        return Err(CertificateError::NotYetValid);
    }
    if now_unix_ms >= certificate.data.expires_at_unix_ms {
        return Err(CertificateError::Expired);
    }
    Ok(())
}

fn check_binding(actual: &str, expected: &str, name: &'static str) -> Result<(), CertificateError> {
    if actual == expected {
        Ok(())
    } else {
        Err(CertificateError::BindingMismatch(name))
    }
}
