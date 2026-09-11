//! Shared backup mechanics. Core owns credentials, scopes, permissions and jobs;
//! apps consume the grant-gated host primitive, never the destination credentials.

pub mod archive;
pub mod encryption;
pub mod s3;
pub mod types;

pub use types::*;
