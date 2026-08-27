#![forbid(unsafe_code)]
//! Typed, deterministic, I/O-free plan verification for Ryu Safe Actions.
//!
//! This crate deliberately does not execute tools, consult mutable state, or infer
//! effects from tool names. Callers provide an attested catalog and policy, then
//! receive a stable report whose bindings can be placed in a Core-owned
//! certificate.

mod canonical;
mod certificate;
mod model;
mod verifier;

pub use canonical::{canonical_json, sha256_canonical, CanonicalError};
pub use certificate::{
    issue_certificate, validate_certificate, Certificate, CertificateBindings, CertificateData,
    CertificateError, CERTIFICATE_SCHEMA_VERSION,
};
pub use model::*;
pub use verifier::{validate_policy, validate_runtime_value, verify, VERIFIER_VERSION};
