//! Typed contracts and pure routing guards for the Sites public edge.
//!
//! This module deliberately contains no origin, node, or port supplied by a
//! public request. The control plane issues connector and route records; the
//! edge selects an active route from the normalized `Host` and path only.

use serde::{Deserialize, Serialize};

/// The managed wildcard base used by the first-party Sites edge.
pub const MANAGED_SITES_DOMAIN: &str = "sites.ryu.app";

/// A connector transport named by the Sites public-edge contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PublicEdgeTransport {
    RyuRelay,
    Frp,
    Cloudflared,
    Rathole,
}

/// The server-owned lifecycle of a node-scoped public-edge connector.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectorStatus {
    Provisioning,
    Connected,
    Degraded,
    Revoked,
}

/// The server-owned lifecycle of a Site route lease.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RouteLeaseStatus {
    Pending,
    Active,
    Draining,
    Revoked,
}

/// The public Site surface served by a route lease.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PublicEdgeTarget {
    Site,
    HelpCenterWidget,
    HelpCenterApi,
}

/// The node-scoped connector record issued by the Sites control plane.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicEdgeConnector {
    pub connector_id: String,
    pub node_id: String,
    pub transport: PublicEdgeTransport,
    pub status: ConnectorStatus,
    pub last_heartbeat_at: Option<String>,
    pub capabilities: Vec<String>,
    pub route_count: u32,
}

/// The server-issued lease binding a host/path prefix to a connector and
/// immutable deployment. It intentionally has no origin, local address, or
/// port: forwarding destinations are never selected from public input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicEdgeRoute {
    pub connector_id: String,
    pub created_at: String,
    pub deployment_id: String,
    pub host: String,
    pub path_prefix: String,
    pub route_id: String,
    pub status: RouteLeaseStatus,
    pub target: PublicEdgeTarget,
    pub updated_at: String,
}

/// The only request fields a public Site frame contributes to route selection.
/// The selected connector and deployment come from the server-issued lease.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicEdgeRequest {
    pub host: String,
    pub path: String,
}

/// A typed frame for the namespaced Site stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum PublicEdgeFrame {
    #[serde(rename = "site.connector")]
    Connector { connector: PublicEdgeConnector },
    #[serde(rename = "site.route")]
    Route { route: PublicEdgeRoute },
    #[serde(rename = "site.request")]
    Request {
        #[serde(flatten)]
        request: PublicEdgeRequest,
    },
}

/// Alias using the product name for callers that keep the Site prefix in their
/// relay protocol types.
pub type SitePublicEdgeFrame = PublicEdgeFrame;

/// Normalize a DNS Host header to lowercase without a trailing dot.
///
/// Only the ordinary HTTP default ports are accepted. An explicit non-default
/// port is rejected so a request cannot influence a destination by smuggling a
/// port through route selection. IP literals, URLs, malformed labels, and
/// whitespace are rejected as well.
pub fn normalize_host(raw: &str) -> Option<String> {
    if raw.is_empty()
        || raw
            .chars()
            .any(|c| c.is_ascii_control() || c.is_ascii_whitespace())
    {
        return None;
    }

    let without_trailing_dot = raw.strip_suffix('.').unwrap_or(raw);
    if without_trailing_dot.is_empty() {
        return None;
    }

    let host = if without_trailing_dot.matches(':').count() == 1 {
        let (host, port) = without_trailing_dot.rsplit_once(':')?;
        let port = port.parse::<u16>().ok()?;
        if !matches!(port, 80 | 443) {
            return None;
        }
        host
    } else {
        without_trailing_dot
    };

    if host.is_empty()
        || host.len() > 253
        || host.parse::<std::net::IpAddr>().is_ok()
        || host.contains(':')
    {
        return None;
    }

    let normalized = host.to_ascii_lowercase();
    if normalized.split('.').any(|label| {
        label.is_empty()
            || label.len() > 63
            || !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            || label.starts_with('-')
            || label.ends_with('-')
    }) {
        return None;
    }

    Some(normalized)
}

/// Return whether an active route lease owns the normalized host/path pair.
///
/// Path matching is segment-aware: `/widget` matches `/widget` and
/// `/widget/...`, but not `/widgets`. Query strings do not participate in route
/// selection. Invalid host or path input fails closed.
pub fn route_matches(route: &PublicEdgeRoute, host: &str, path: &str) -> bool {
    if route.status != RouteLeaseStatus::Active {
        return false;
    }

    let Some(request_host) = normalize_host(host) else {
        return false;
    };
    let Some(route_host) = normalize_host(&route.host) else {
        return false;
    };
    if request_host != route_host {
        return false;
    }

    let Some(prefix) = normalize_path(&route.path_prefix, false) else {
        return false;
    };
    let Some(request_path) = normalize_path(path, true) else {
        return false;
    };

    if prefix == "/" {
        return true;
    }
    if request_path == prefix {
        return true;
    }

    request_path
        .strip_prefix(prefix)
        .is_some_and(|remaining| remaining.starts_with('/'))
}

/// Validate a host against a managed wildcard such as `*.sites.ryu.app`.
/// Exactly one DNS label may occupy the wildcard; the base domain and nested
/// subdomains are rejected.
pub fn is_valid_wildcard_managed_domain(candidate: &str, managed_domain: &str) -> bool {
    let Some(candidate) = normalize_host(candidate) else {
        return false;
    };
    let managed_domain = managed_domain.strip_prefix("*.").unwrap_or(managed_domain);
    let Some(managed_domain) = normalize_host(managed_domain) else {
        return false;
    };
    let suffix = format!(".{managed_domain}");
    let Some(label) = candidate.strip_suffix(&suffix) else {
        return false;
    };

    !label.is_empty() && !label.contains('.') && normalize_host(label).is_some()
}

/// Validate a host against the managed Sites wildcard.
pub fn is_managed_site_domain(candidate: &str) -> bool {
    is_valid_wildcard_managed_domain(candidate, MANAGED_SITES_DOMAIN)
}

/// Compatibility spelling for callers that prefer a verb-style validator.
pub fn validate_wildcard_managed_domain(candidate: &str, managed_domain: &str) -> bool {
    is_valid_wildcard_managed_domain(candidate, managed_domain)
}

fn normalize_path(raw: &str, allow_query: bool) -> Option<&str> {
    if raw.is_empty()
        || !raw.starts_with('/')
        || raw
            .chars()
            .any(|c| c.is_ascii_control() || c == '\\' || c == '#')
    {
        return None;
    }

    let path = if allow_query {
        raw.split_once('?').map_or(raw, |(path, _)| path)
    } else {
        raw
    };
    if path.is_empty() || path.split('/').any(|segment| matches!(segment, "." | "..")) {
        return None;
    }
    Some(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn connector(status: ConnectorStatus) -> PublicEdgeConnector {
        PublicEdgeConnector {
            connector_id: "conn-1".to_owned(),
            node_id: "node-1".to_owned(),
            transport: PublicEdgeTransport::RyuRelay,
            status,
            last_heartbeat_at: Some("2026-08-24T00:00:00Z".to_owned()),
            capabilities: vec!["http".to_owned(), "https".to_owned()],
            route_count: 1,
        }
    }

    fn route(status: RouteLeaseStatus) -> PublicEdgeRoute {
        PublicEdgeRoute {
            connector_id: "conn-1".to_owned(),
            created_at: "2026-08-24T00:00:00Z".to_owned(),
            deployment_id: "deployment-1".to_owned(),
            host: "Docs.Sites.Ryu.App.".to_owned(),
            path_prefix: "/widget".to_owned(),
            route_id: "route-1".to_owned(),
            status,
            target: PublicEdgeTarget::Site,
            updated_at: "2026-08-24T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn connector_and_route_statuses_use_approved_wire_values() {
        assert_eq!(
            serde_json::to_value(connector(ConnectorStatus::Connected)).unwrap()["status"],
            "connected"
        );
        assert_eq!(
            serde_json::to_value(route(RouteLeaseStatus::Draining)).unwrap()["status"],
            "draining"
        );
        assert_eq!(
            serde_json::to_value(PublicEdgeTransport::RyuRelay).unwrap(),
            "ryu-relay"
        );
        assert_eq!(
            serde_json::to_value(PublicEdgeTarget::HelpCenterWidget).unwrap(),
            "help-center-widget"
        );
    }

    #[test]
    fn site_public_edge_frames_round_trip_with_camel_case_contract() {
        let frame = PublicEdgeFrame::Route {
            route: route(RouteLeaseStatus::Active),
        };
        let value = serde_json::to_value(&frame).unwrap();

        assert_eq!(value["type"], "site.route");
        assert_eq!(value["route"]["connectorId"], "conn-1");
        assert_eq!(value["route"]["pathPrefix"], "/widget");
        assert_eq!(
            serde_json::from_value::<PublicEdgeFrame>(value).unwrap(),
            frame
        );
    }

    #[test]
    fn request_frame_has_no_client_selected_origin_node_or_port() {
        let valid = json!({
            "type": "site.request",
            "host": "docs.sites.ryu.app",
            "path": "/widget.js"
        });
        assert!(serde_json::from_value::<PublicEdgeFrame>(valid).is_ok());

        let injected = json!({
            "type": "site.request",
            "host": "docs.sites.ryu.app",
            "path": "/widget.js",
            "origin": "https://attacker.example",
            "nodeId": "attacker-node",
            "port": 8443
        });
        assert!(serde_json::from_value::<PublicEdgeFrame>(injected).is_err());
    }

    #[test]
    fn normalize_host_canonicalizes_dns_and_only_default_ports() {
        assert_eq!(
            normalize_host("Docs.Sites.Ryu.App."),
            Some("docs.sites.ryu.app".to_owned())
        );
        assert_eq!(
            normalize_host("docs.sites.ryu.app:443"),
            Some("docs.sites.ryu.app".to_owned())
        );
        assert_eq!(
            normalize_host("docs.sites.ryu.app:80"),
            Some("docs.sites.ryu.app".to_owned())
        );
        assert!(normalize_host("docs.sites.ryu.app:8443").is_none());
        assert!(normalize_host("https://docs.sites.ryu.app").is_none());
        assert!(normalize_host("docs..sites.ryu.app").is_none());
    }

    #[test]
    fn active_route_matches_host_and_path_prefix_at_segment_boundary() {
        let active = route(RouteLeaseStatus::Active);
        assert!(route_matches(
            &active,
            "docs.sites.ryu.app:443",
            "/widget?cache=1"
        ));
        assert!(route_matches(
            &active,
            "docs.sites.ryu.app",
            "/widget/assets/app.js"
        ));
        assert!(!route_matches(&active, "other.sites.ryu.app", "/widget.js"));
        assert!(!route_matches(&active, "docs.sites.ryu.app", "/widgets.js"));
        assert!(!route_matches(
            &active,
            "docs.sites.ryu.app:8443",
            "/widget.js"
        ));
    }

    #[test]
    fn non_active_route_leases_never_match() {
        for status in [
            RouteLeaseStatus::Pending,
            RouteLeaseStatus::Draining,
            RouteLeaseStatus::Revoked,
        ] {
            assert!(!route_matches(
                &route(status),
                "docs.sites.ryu.app",
                "/widget.js"
            ));
        }
    }

    #[test]
    fn wildcard_managed_domain_requires_exactly_one_site_label() {
        assert!(is_valid_wildcard_managed_domain(
            "Docs.Sites.Ryu.App.",
            "*.sites.ryu.app"
        ));
        assert!(is_valid_wildcard_managed_domain(
            "docs.sites.ryu.app",
            "sites.ryu.app"
        ));
        assert!(!is_valid_wildcard_managed_domain(
            "sites.ryu.app",
            "*.sites.ryu.app"
        ));
        assert!(!is_valid_wildcard_managed_domain(
            "nested.docs.sites.ryu.app",
            "*.sites.ryu.app"
        ));
        assert!(!is_valid_wildcard_managed_domain(
            "docs.sites.ryu.app.evil.example",
            "*.sites.ryu.app"
        ));
    }
}
