use axum::{http::StatusCode, response::IntoResponse};
use serde::{Deserialize, Serialize};

/// Public disclosure metadata, not identity attestation or permission to scan.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PublicContactConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub contact: String,
    #[serde(default)]
    pub canonical: String,
    #[serde(default)]
    pub expires: String,
}

fn single_line(value: &str, limit: usize) -> bool {
    value.len() <= limit && !value.chars().any(char::is_control)
}

/// Fail closed on disabled, malformed, or stale operator metadata. The source is
/// gateway.toml; no account identity, host metadata, or credentials are inferred.
pub fn render_contact(
    config: &PublicContactConfig,
    now: chrono::DateTime<chrono::Utc>,
) -> Option<String> {
    if !config.enabled
        || !single_line(&config.name, 80)
        || !single_line(&config.contact, 300)
        || !single_line(&config.canonical, 300)
    {
        return None;
    }
    let expires = chrono::DateTime::parse_from_rfc3339(&config.expires).ok()?;
    if expires <= now || expires > now + chrono::Duration::days(366) {
        return None;
    }
    let canonical = reqwest::Url::parse(&config.canonical).ok()?;
    if canonical.scheme() != "https"
        || canonical.host_str().is_none()
        || !canonical.username().is_empty()
        || canonical.password().is_some()
        || canonical.query().is_some()
        || canonical.fragment().is_some()
        || canonical.path() != "/.well-known/security.txt"
    {
        return None;
    }
    let contact = reqwest::Url::parse(&config.contact).ok()?;
    if contact.query().is_some() || contact.fragment().is_some() {
        return None;
    }
    match contact.scheme() {
        "https"
            if contact.host_str().is_some()
                && contact.username().is_empty()
                && contact.password().is_none() => {}
        "mailto"
            if contact.path().contains('@') && !contact.path().contains([' ', '%', ',', ';']) => {}
        _ => return None,
    }
    let name = if config.name.is_empty() {
        String::new()
    } else {
        format!("# {}\n", config.name)
    };
    Some(format!(
        "{name}Contact: {}\nExpires: {}\nCanonical: {}\n",
        config.contact,
        expires.to_rfc3339(),
        config.canonical
    ))
}

pub fn response(config: &PublicContactConfig) -> impl IntoResponse {
    match render_contact(config, chrono::Utc::now()) {
        Some(body) => (
            StatusCode::OK,
            [
                ("content-type", "text/plain; charset=utf-8"),
                ("cache-control", "no-store"),
                ("x-content-type-options", "nosniff"),
            ],
            body,
        ),
        None => (
            StatusCode::NOT_FOUND,
            [
                ("content-type", "text/plain; charset=utf-8"),
                ("cache-control", "no-store"),
                ("x-content-type-options", "nosniff"),
            ],
            String::new(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contact_is_opt_in_bounded_and_expires() {
        let now = chrono::Utc::now();
        assert!(render_contact(&PublicContactConfig::default(), now).is_none());
        let mut config = PublicContactConfig {
            enabled: true,
            name: "Example node".into(),
            contact: "mailto:security@example.com".into(),
            canonical: "https://node.example.com/.well-known/security.txt".into(),
            expires: (now + chrono::Duration::days(30)).to_rfc3339(),
        };
        let rendered = render_contact(&config, now).unwrap();
        assert!(rendered.contains("Contact: mailto:security@example.com\n"));
        config.name = "Example\nContact: mailto:attacker@example.net".into();
        assert!(render_contact(&config, now).is_none());
        config.name = "Example".into();
        config.expires = (now - chrono::Duration::days(1)).to_rfc3339();
        assert!(render_contact(&config, now).is_none());
    }
}
