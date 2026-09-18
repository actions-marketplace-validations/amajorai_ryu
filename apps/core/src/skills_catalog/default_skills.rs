//! Legacy constants for the optional document/design skill pack.
//!
//! External skills are selected and installed by
//! [`super::system_skills`]. Ryu's own PDF skill is embedded in the
//! `ryu-skills` crate and is never fetched from this upstream repository.

/// The upstream repository containing the document/design skills.
pub const DEFAULT_SKILL_REPO: &str = "anthropics/skills";

/// Historical single-skill defaults. They are only considered when the
/// administrator selects the Anthropic pack; they are not a boot default.
pub const DEFAULT_SKILLS: &[&str] = &["xlsx", "pptx", "docx", "frontend-design"];
