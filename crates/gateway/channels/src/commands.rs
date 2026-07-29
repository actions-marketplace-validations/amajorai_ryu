//! The command menu a channel publishes, sourced from Core.
//!
//! The desktop composer offers three kinds of slash command (see
//! `SlashCommandAutocomplete.tsx`): commands a plugin contributes, commands the
//! active agent advertises over ACP, and Ryu's own built-ins. A channel bot is the
//! same assistant reached over a different wire, so it should offer the same set —
//! otherwise `/proof` works in the desktop and silently becomes a literal message
//! in Telegram.
//!
//! Core owns that union and serves it at `GET /api/channels/commands`. This module
//! is the client: it fetches the list, normalises it to what a platform command
//! menu can express, and caches it so publishing on every reconnect is cheap.
//!
//! Execution needs nothing here. Plugin commands are intercepted by
//! `pre_user_turn` hooks inside Core's `run_reply_text`, which the channel path
//! already goes through — the command text simply has to *reach* Core intact. What
//! was missing was never dispatch; it was discovery.

use std::time::Duration;

use serde::Deserialize;
use tracing::{debug, warn};

/// Timeout for the command-registry fetch. Short: a channel that cannot reach Core
/// should start with an empty menu, not block its connect path.
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// Telegram caps a bot's command list at 100 entries. Other platforms are either
/// looser or have no menu at all, so this is the shared ceiling.
const MAX_COMMANDS: usize = 100;

/// One command as a platform menu can express it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ChannelCommand {
    /// Command name WITHOUT the leading slash, already normalised to the strictest
    /// platform rule (Telegram: 1-32 chars of `a-z`, `0-9`, `_`).
    pub name: String,
    /// One-line description shown next to the command in the menu.
    pub description: String,
    /// Where the command came from: `plugin`, `skill`, `agent`, or `builtin`.
    /// Carried through so an operator can tell why a command is offered.
    #[serde(default)]
    pub source: String,
}

/// Core's `GET /api/channels/commands` response.
#[derive(Debug, Deserialize)]
struct CommandsResponse {
    #[serde(default)]
    commands: Vec<ChannelCommand>,
}

/// Fetch the command union from Core.
///
/// Returns an empty vec on any failure — a channel with no menu still works
/// (commands typed by hand reach Core regardless), so this must never be fatal.
pub async fn fetch(http: &reqwest::Client, core_url: &str) -> Vec<ChannelCommand> {
    let url = format!("{}/api/channels/commands", core_url.trim_end_matches('/'));
    let resp = match http.get(&url).timeout(FETCH_TIMEOUT).send().await {
        Ok(r) => r,
        Err(err) => {
            warn!(%err, "channel command registry unreachable; publishing no menu");
            return Vec::new();
        }
    };
    if !resp.status().is_success() {
        warn!(status = %resp.status(), "channel command registry returned non-2xx");
        return Vec::new();
    }
    match resp.json::<CommandsResponse>().await {
        Ok(parsed) => {
            let commands = normalize(parsed.commands);
            debug!(count = commands.len(), "fetched channel command menu");
            commands
        }
        Err(err) => {
            warn!(%err, "channel command registry response did not parse");
            Vec::new()
        }
    }
}

/// Normalise a raw command list into something every platform menu accepts:
/// lowercase the name, strip a leading slash, drop anything that cannot be made
/// legal, de-duplicate, truncate descriptions, and cap the total.
///
/// Pure so the rules are unit-testable without a Core to talk to.
pub fn normalize(raw: Vec<ChannelCommand>) -> Vec<ChannelCommand> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for cmd in raw {
        let Some(name) = normalize_name(&cmd.name) else {
            continue;
        };
        if !seen.insert(name.clone()) {
            continue;
        }
        out.push(ChannelCommand {
            name,
            description: normalize_description(&cmd.description),
            source: cmd.source,
        });
        if out.len() == MAX_COMMANDS {
            break;
        }
    }
    out
}

/// Coerce a command name to Telegram's rule (the strictest of the platforms we
/// publish to): 1-32 chars, lowercase `a-z`, `0-9` and `_` only. Characters that
/// cannot be mapped (`-` and `.` become `_`) disqualify the command rather than
/// producing a name that would be rejected at publish time.
fn normalize_name(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_start_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    let mut name = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        match ch {
            'a'..='z' | '0'..='9' | '_' => name.push(ch),
            'A'..='Z' => name.push(ch.to_ascii_lowercase()),
            '-' | '.' | ' ' => name.push('_'),
            _ => return None,
        }
    }
    // A name of only underscores carries no meaning and Telegram rejects a
    // leading digit, so both are dropped rather than published broken.
    if name.chars().all(|c| c == '_') || name.starts_with(|c: char| c.is_ascii_digit()) {
        return None;
    }
    name.truncate(32);
    Some(name)
}

/// Telegram shows at most ~256 characters of description; anything longer is
/// clipped on an ellipsis so the menu row stays readable.
fn normalize_description(raw: &str) -> String {
    const MAX: usize = 250;
    let one_line = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= MAX {
        return one_line;
    }
    let clipped: String = one_line.chars().take(MAX).collect();
    format!("{clipped}…")
}

/// Split an inbound message into `(command, remainder)` when it starts with a
/// slash command, or `None` when it is ordinary text.
///
/// Handles Telegram's `/cmd@botname` form so a command typed in a group — where
/// clients append the bot's username — matches the bare command name. Used by the
/// platforms with no native command menu (WhatsApp, iMessage) to recognise a
/// command, and by every platform to decide whether a group message is addressed
/// to the bot.
pub fn parse_command(text: &str) -> Option<(String, String)> {
    let trimmed = text.trim_start();
    let rest = trimmed.strip_prefix('/')?;
    let (head, tail) = match rest.find(char::is_whitespace) {
        Some(idx) => (&rest[..idx], rest[idx..].trim_start()),
        None => (rest, ""),
    };
    // `/cmd@botname` → `cmd`.
    let head = head.split('@').next().unwrap_or(head);
    if head.is_empty() {
        return None;
    }
    Some((head.to_ascii_lowercase(), tail.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cmd(name: &str, description: &str) -> ChannelCommand {
        ChannelCommand {
            name: name.to_string(),
            description: description.to_string(),
            source: "plugin".to_string(),
        }
    }

    #[test]
    fn normalize_strips_slash_and_lowercases() {
        let out = normalize(vec![cmd("/Proof", "prove it")]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "proof");
    }

    #[test]
    fn normalize_maps_separators_and_rejects_illegal_names() {
        assert_eq!(normalize_name("make-skill").as_deref(), Some("make_skill"));
        assert_eq!(normalize_name("a.b").as_deref(), Some("a_b"));
        // Emoji / punctuation cannot be represented in a Telegram command.
        assert_eq!(normalize_name("go!"), None);
        assert_eq!(normalize_name("🚀"), None);
        // Leading digits and all-underscore names are rejected.
        assert_eq!(normalize_name("2fast"), None);
        assert_eq!(normalize_name("__"), None);
        assert_eq!(normalize_name(""), None);
    }

    #[test]
    fn normalize_dedupes_and_caps() {
        let dupes = vec![cmd("/goal", "first"), cmd("goal", "second")];
        let out = normalize(dupes);
        assert_eq!(out.len(), 1, "the same name must only be published once");
        assert_eq!(out[0].description, "first", "first wins");

        let many: Vec<_> = (0..150).map(|i| cmd(&format!("cmd_{i}"), "x")).collect();
        assert_eq!(normalize(many).len(), MAX_COMMANDS);
    }

    #[test]
    fn normalize_description_flattens_and_clips() {
        assert_eq!(normalize_description("two\n  lines"), "two lines");
        let long = "x".repeat(400);
        let clipped = normalize_description(&long);
        assert_eq!(clipped.chars().count(), 251, "250 chars plus the ellipsis");
        assert!(clipped.ends_with('…'));
    }

    #[test]
    fn parse_command_handles_args_and_bot_suffix() {
        assert_eq!(
            parse_command("/goal ship it"),
            Some(("goal".into(), "ship it".into()))
        );
        assert_eq!(parse_command("/goal"), Some(("goal".into(), "".into())));
        // Group clients append the bot username.
        assert_eq!(
            parse_command("/goal@ryubot ship it"),
            Some(("goal".into(), "ship it".into()))
        );
        assert_eq!(parse_command("  /Help"), Some(("help".into(), "".into())));
        assert_eq!(parse_command("not a command"), None);
        assert_eq!(parse_command("/"), None);
    }
}
