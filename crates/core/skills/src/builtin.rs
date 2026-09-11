//! Built-in skills embedded for offline installs.
//!
//! The Ryu-authored skills live in `apps/skills/`. The MIT-licensed pstack pack
//! is vendored under `apps/skills/pstack/skills/`; the build script generates a
//! complete compile-time file map so references, playbooks, and scripts travel
//! with each skill instead of being reduced to its `SKILL.md` only.

use std::io::Write;
use std::path::Path;

#[derive(Clone, Copy)]
struct BuiltinFile {
    path: &'static str,
    source: &'static str,
}

#[derive(Clone, Copy)]
struct BuiltinSkill {
    id: &'static str,
    files: &'static [BuiltinFile],
}

static RYU_HEALTH_AUDIT_FILES: &[BuiltinFile] = &[BuiltinFile {
    path: "SKILL.md",
    source: include_str!("../../../../apps/skills/ryu-health-audit/SKILL.md"),
}];
static RYU_AGENT_CREATOR_FILES: &[BuiltinFile] = &[BuiltinFile {
    path: "SKILL.md",
    source: include_str!("../../../../apps/skills/ryu-agent-creator/SKILL.md"),
}];
static RYU_CREATOR_FILES: &[BuiltinFile] = &[BuiltinFile {
    path: "SKILL.md",
    source: include_str!("../../../../apps/skills/ryu-creator/SKILL.md"),
}];
static RYU_CONFIGURATOR_FILES: &[BuiltinFile] = &[BuiltinFile {
    path: "SKILL.md",
    source: include_str!("../../../../apps/skills/ryu-configurator/SKILL.md"),
}];
static PDF_FILES: &[BuiltinFile] = &[BuiltinFile {
    path: "SKILL.md",
    source: include_str!("../../../../apps/skills/pdf/SKILL.md"),
}];

const RYU_SKILLS: &[BuiltinSkill] = &[
    BuiltinSkill {
        id: "ryu-health-audit",
        files: RYU_HEALTH_AUDIT_FILES,
    },
    BuiltinSkill {
        id: "ryu-agent-creator",
        files: RYU_AGENT_CREATOR_FILES,
    },
    BuiltinSkill {
        id: "ryu-creator",
        files: RYU_CREATOR_FILES,
    },
    BuiltinSkill {
        id: "ryu-configurator",
        files: RYU_CONFIGURATOR_FILES,
    },
    BuiltinSkill {
        id: "pdf",
        files: PDF_FILES,
    },
];

include!(concat!(env!("OUT_DIR"), "/pstack_bundle.rs"));

fn builtin_skills() -> impl Iterator<Item = &'static BuiltinSkill> {
    RYU_SKILLS.iter().chain(PSTACK_SKILLS.iter())
}

/// Publish a complete skill tree without replacing an existing user-owned copy.
#[cfg(test)]
fn install(dir: &Path, source: &'static str) -> std::io::Result<bool> {
    install_files(
        dir,
        &[BuiltinFile {
            path: "SKILL.md",
            source,
        }],
    )
}

/// Stage a skill tree, claim its destination directory, and move the files into
/// place. `SKILL.md` moves last so a concurrent reload never observes a skill
/// before its referenced resources are present.
fn install_files(dir: &Path, files: &[BuiltinFile]) -> std::io::Result<bool> {
    let parent = dir.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "built-in skill has no parent directory",
        )
    })?;
    std::fs::create_dir_all(parent)?;
    let id = dir
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "built-in skill directory is not valid UTF-8",
            )
        })?;
    let temp = parent.join(format!(".builtin-{id}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&temp)?;
    let mut claimed = false;
    let result = (|| {
        for file in files {
            let destination = temp.join(file.path);
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut output = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(destination)?;
            output.write_all(file.source.as_bytes())?;
            output.sync_all()?;
        }

        match std::fs::create_dir(dir) {
            Ok(()) => {
                claimed = true;
                for file in files.iter().filter(|file| file.path != "SKILL.md") {
                    move_file(&temp, dir, file.path)?;
                }
                move_file(&temp, dir, "SKILL.md")?;
                Ok(true)
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
            Err(error) => Err(error),
        }
    })();
    if claimed && result.is_err() {
        let _ = std::fs::remove_dir_all(dir);
    }
    let _ = std::fs::remove_dir_all(&temp);
    result
}

fn move_file(temp: &Path, destination: &Path, relative_path: &str) -> std::io::Result<()> {
    let from = temp.join(relative_path);
    let to = destination.join(relative_path);
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(from, to)
}

pub(super) fn install_defaults() {
    let existing = super::scan_all_skill_dirs();
    for skill in builtin_skills() {
        // Include both universal roots: never shadow a copy installed by another agent.
        if existing.iter().any(|installed| installed.id == skill.id) {
            continue;
        }
        match install_files(
            &super::SkillRegistry::skills_dir().join(skill.id),
            skill.files,
        ) {
            Ok(true) => {
                super::set_active(skill.id, true);
                tracing::info!(id = skill.id, "installed embedded skill");
            }
            Ok(false) => {}
            Err(error) => {
                tracing::warn!(id = skill.id, %error, "could not install embedded skill")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_defaults_load_source_and_respect_activation_and_allowlists() {
        let _guard = crate::SKILLS_ENV_LOCK.lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        std::env::set_var("RYU_SKILLS_DIR", temp.path().join("skills"));
        std::env::set_var("RYU_SKILLS_ACTIVE_FILE", temp.path().join("active.json"));
        // Avoid legacy migration or any dependency on the user's actual home.
        std::fs::write(temp.path().join("active.json"), "[]").unwrap();
        install_defaults();
        let registry = crate::SkillRegistry::empty();
        registry.reload();
        for skill in builtin_skills() {
            let source = skill
                .files
                .iter()
                .find(|file| file.path == "SKILL.md")
                .expect("every built-in skill has SKILL.md")
                .source;
            let id = skill.id;
            let record = crate::parse_skill_md(id, source).unwrap();
            assert!(!record.always_on);
            assert!(!record.instructions.is_empty());
            assert_eq!(
                crate::store::read_skill_source(id).unwrap().as_deref(),
                Some(source)
            );
            for file in skill.files {
                assert_eq!(
                    std::fs::read_to_string(
                        crate::SkillRegistry::skills_dir().join(id).join(file.path)
                    )
                    .unwrap(),
                    file.source,
                    "bundled resource was not materialized: {id}/{}",
                    file.path
                );
            }
            assert_eq!(registry.enabled_for(&[id.to_owned()]).len(), 1);
            let (index, eager_ids) = registry.progressive_block(&[id.to_owned()]).unwrap();
            assert!(index.contains(id));
            assert!(!index.contains(&record.instructions));
            assert!(eager_ids.is_empty());
            let (body, loaded_ids) = registry.skill_block(&[id.to_owned()]).unwrap();
            assert!(body.contains(&record.instructions));
            assert_eq!(loaded_ids, vec![id]);
        }
        assert!(registry.enabled_for(&["unrelated".to_owned()]).is_empty());
        crate::try_set_active("ryu-creator", false).unwrap();
        let custom = "---\nname: custom\ndescription: User edition\n---\nCustom instructions\n";
        std::fs::write(temp.path().join("skills/ryu-configurator/SKILL.md"), custom).unwrap();
        install_defaults();
        registry.reload();
        assert!(registry.enabled_for(&["ryu-creator".to_owned()]).is_empty());
        assert_eq!(
            crate::store::read_skill_source("ryu-configurator")
                .unwrap()
                .as_deref(),
            Some(custom)
        );
        std::env::remove_var("RYU_SKILLS_DIR");
        std::env::remove_var("RYU_SKILLS_ACTIVE_FILE");
    }

    #[test]
    fn atomic_install_preserves_existing_copy_and_cleans_temporary_file() {
        let temp = tempfile::tempdir().unwrap();
        let destination = temp.path().join("skill");
        assert!(install(&destination, "first").unwrap());
        assert!(!install(&destination, "second").unwrap());
        assert_eq!(
            std::fs::read_to_string(destination.join("SKILL.md")).unwrap(),
            "first"
        );
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[test]
    fn pstack_bundle_keeps_the_complete_skill_tree() {
        assert_eq!(PSTACK_SKILLS.len(), 47);
        let poteto_mode = PSTACK_SKILLS
            .iter()
            .find(|skill| skill.id == "poteto-mode")
            .expect("poteto-mode is bundled");
        assert!(poteto_mode
            .files
            .iter()
            .any(|file| file.path == "playbooks/bug-fix.md"));
        assert!(poteto_mode
            .files
            .iter()
            .any(|file| file.path == "scripts/check-plan.mjs"));
    }

    #[test]
    fn pdf_skill_is_bundled_with_its_source() {
        let pdf = builtin_skills()
            .find(|skill| skill.id == "pdf")
            .expect("pdf skill is bundled");
        let source = pdf
            .files
            .iter()
            .find(|file| file.path == "SKILL.md")
            .expect("pdf skill has SKILL.md")
            .source;
        assert!(source.contains("pdfcn"));
        assert!(source.contains("Verification is part of completion"));
    }
}
