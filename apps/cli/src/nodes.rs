use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// Core port Core listens on (the release profile).
const CORE_PORT: u16 = 7980;

/// Every profile's Core port, mirroring `apps/core/src/profile.rs`'s
/// PROFILE_PORT_OFFSETS (release +0, dev +1000, canary +2000, nightly +3000,
/// beta +4000).
///
/// Discovery swept ONE port — whichever profile the caller was on — so a stable
/// client could never find a canary node, not even on this machine. Listing them
/// here rather than importing keeps `apps/cli` free of a dependency on Core, at
/// the cost of a table that must move with it; `profile_ports_match_cores_table`
/// pins the values.
const PROFILE_PORTS: [(&str, u16); 5] = [
    ("release", 7980),
    ("dev", 8980),
    ("canary", 9980),
    ("nightly", 10_980),
    ("beta", 11_980),
];
// Bounded sweep: probe at most this many hosts per run to keep latency below ~3 s.
const MAX_SWEEP_HOSTS: u8 = 254;
// Per-host connection timeout in milliseconds.
const PROBE_TIMEOUT_MS: u64 = 800;

/// How to reach a node over the mesh (#478). When present, [`Node::mesh_client`]
/// dials the node's `url` through the node's userspace SOCKS5 proxy so the
/// connection rides the tailnet instead of the LAN.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
pub struct MeshAddr {
    /// The `host:port` of the userspace SOCKS5 proxy exposed by the node's
    /// Tailscale daemon (e.g. `127.0.0.1:1055` for a local proxy, or a peer's
    /// MagicDNS name when proxying remotely).
    pub socks5: String,
    /// Optional MagicDNS name of the peer, for display.
    #[serde(default)]
    pub magic_dns_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Node {
    pub name: String,
    pub url: String,
    pub token: Option<String>,
    /// Optional mesh address (#478). `#[serde(default)]` so a legacy
    /// `nodes.json` written before mesh support still deserializes.
    #[serde(default)]
    pub mesh: Option<MeshAddr>,
}

impl Node {
    /// Build a reqwest client for this node. When the node has a [`MeshAddr`],
    /// the client routes through the node's userspace SOCKS5 proxy via a
    /// `socks5h://` proxy (the `h` keeps DNS resolution on the proxy side, so
    /// MagicDNS names resolve on the tailnet). Without a mesh address it is a
    /// plain client (LAN/loopback).
    pub fn mesh_client(&self) -> reqwest::Result<reqwest::Client> {
        let builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30));
        match &self.mesh {
            Some(mesh) if !mesh.socks5.is_empty() => {
                let proxy = reqwest::Proxy::all(format!("socks5h://{}", mesh.socks5))?;
                builder.proxy(proxy).build()
            }
            _ => builder.build(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NodesConfig {
    pub default: String,
    pub nodes: Vec<Node>,
}

pub fn nodes_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".ryu").join("nodes.json")
}

pub fn load() -> NodesConfig {
    let path = nodes_path();
    let mut config = match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| default_config()),
        Err(_) => default_config(),
    };
    fill_local_token(&mut config);
    config
}

/// Path to the node-admittance token Core mints on first boot
/// (`apps/core/src/node_token.rs`).
fn node_auth_token_path() -> PathBuf {
    nodes_path()
        .parent()
        .map(|dir| dir.join("node-auth.token"))
        .unwrap_or_else(|| PathBuf::from("node-auth.token"))
}

/// Read the local node's minted auth token, if present.
fn read_local_node_token() -> Option<String> {
    // An operator-provisioned RYU_TOKEN wins, mirroring Core's own precedence.
    if let Ok(env_token) = std::env::var("RYU_TOKEN") {
        let trimmed = env_token.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_owned());
        }
    }
    let raw = std::fs::read_to_string(node_auth_token_path()).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_owned())
}

/// True when `url` addresses THIS machine's Core — the only node whose token
/// lives on local disk. A remote node must never be handed this secret.
///
/// Parsed with `reqwest::Url` (the `url` crate, already in the dependency tree)
/// rather than by trimming prefixes. Hand-rolled parsing gets this wrong in a way
/// that LEAKS: in `http://localhost:80@evil.com/`, `localhost:80` is USERINFO and
/// the real host is `evil.com`, but splitting on the last `:` reads the host as
/// `localhost` and would hand this machine's token to `evil.com`. `Url::host_str`
/// strips userinfo, so the check sees the authority the request will actually go
/// to. Fails closed on a URL that will not parse.
fn is_local_node_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    // `host_str` keeps IPv6 literals bracketed (`[::1]`); a trailing dot is the
    // DNS root and resolves identically. Normalize both, and lowercase because
    // host comparison is case-insensitive.
    let host = host
        .trim_matches(|c| c == '[' || c == ']')
        .trim_end_matches('.')
        .to_ascii_lowercase();
    matches!(host.as_str(), "127.0.0.1" | "localhost" | "::1")
}

/// Attach the on-disk minted token to any LOCAL node that has none.
///
/// Core authenticates its local API by default, and the CLI is not a child of
/// Core, so without this every `ryu` command against the local node 401s. Done
/// at load time and stripped again in [`save`], so the secret never lands in
/// `nodes.json` (which has no restrictive mode). An explicit token already in
/// the config always wins.
fn fill_local_token(config: &mut NodesConfig) {
    let Some(token) = read_local_node_token() else {
        return;
    };
    for node in &mut config.nodes {
        if node.token.is_none() && is_local_node_url(&node.url) {
            node.token = Some(token.clone());
        }
    }
}

fn default_config() -> NodesConfig {
    NodesConfig {
        default: "local".into(),
        nodes: vec![Node {
            name: "local".into(),
            url: "http://127.0.0.1:2049".into(),
            token: None,
            mesh: None,
        }],
    }
}

pub fn save(config: &NodesConfig) -> anyhow::Result<()> {
    let path = nodes_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Undo `fill_local_token` before writing: every mutating path is
    // load -> mutate -> save, and round-tripping the injected token would copy a
    // secret into `nodes.json`. Only the CURRENT on-disk token is stripped, so a
    // token an operator pinned by hand survives untouched.
    let mut to_write = NodesConfig {
        default: config.default.clone(),
        nodes: config.nodes.clone(),
    };
    if let Some(disk_token) = read_local_node_token() {
        for node in &mut to_write.nodes {
            if node.token.as_deref() == Some(disk_token.as_str()) && is_local_node_url(&node.url) {
                node.token = None;
            }
        }
    }
    std::fs::write(&path, serde_json::to_string_pretty(&to_write)?)?;
    Ok(())
}

/// Returns the active node (the one named `config.default`).
/// Falls back to the local node if the default is missing.
pub fn active_node() -> Node {
    resolve_active_node(&load())
}

/// Returns the node named `name`, or an error if not found.
pub fn get_node(name: &str) -> anyhow::Result<Node> {
    resolve_node_by_name(&load(), name)
}

/// Persist `name` as the new default node.
/// Returns an error when the name does not exist in the config.
pub fn set_active(name: &str) -> anyhow::Result<()> {
    let mut config = load();
    if !config.nodes.iter().any(|n| n.name == name) {
        anyhow::bail!("node '{}' not found", name);
    }
    config.default = name.to_owned();
    save(&config)
}

/// Pure selector: prefers the first non-local node that has a corresponding
/// `true` in `reachable`, then falls back to the local node.
/// `nodes` and `reachable` are parallel slices.
pub fn select_preferred(nodes: &[Node], reachable: &[bool]) -> Node {
    // Prefer the first reachable non-local node.
    for (node, &ok) in nodes.iter().zip(reachable.iter()) {
        if ok && node.name != "local" {
            return node.clone();
        }
    }
    // Fall back to local (always present by invariant).
    nodes
        .iter()
        .find(|n| n.name == "local")
        .cloned()
        .unwrap_or_else(|| Node {
            name: "local".into(),
            url: "http://127.0.0.1:2049".into(),
            token: None,
            mesh: None,
        })
}

fn resolve_active_node(config: &NodesConfig) -> Node {
    config
        .nodes
        .iter()
        .find(|n| n.name == config.default)
        .cloned()
        .unwrap_or_else(|| Node {
            name: "local".into(),
            url: "http://127.0.0.1:2049".into(),
            token: None,
            mesh: None,
        })
}

fn resolve_node_by_name(config: &NodesConfig, name: &str) -> anyhow::Result<Node> {
    config
        .nodes
        .iter()
        .find(|n| n.name == name)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("node '{}' not found", name))
}

/// Discovered node returned by [`discover_lan`].
#[derive(Debug, Clone, PartialEq)]
pub struct DiscoveredNode {
    pub url: String,
    pub latency_ms: u64,
}

/// Probe a single `host:port` for a live Core `/api/health` endpoint.
/// Returns `Some(latency_ms)` when the response is 2xx, `None` otherwise.
async fn probe(client: &reqwest::Client, host: &str, port: u16) -> Option<u64> {
    let url = format!("http://{host}:{port}/api/health");
    let start = std::time::Instant::now();
    match client.get(&url).send().await {
        Ok(r) if r.status().is_success() => Some(start.elapsed().as_millis() as u64),
        _ => None,
    }
}

/// Parse the local subnet prefix from a dotted-quad address string.
/// e.g. "192.168.1.42" -> "192.168.1"
fn subnet_prefix(addr: &str) -> Option<String> {
    let parts: Vec<&str> = addr.split('.').collect();
    if parts.len() == 4 {
        Some(format!("{}.{}.{}", parts[0], parts[1], parts[2]))
    } else {
        None
    }
}

/// Resolve the default outbound IPv4 address by connecting a UDP socket
/// to a well-known external address (8.8.8.8:80).  No packets are sent.
fn local_ipv4() -> Option<String> {
    use std::net::UdpSocket;
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}

/// Sweep the local /24 subnet for Core nodes advertising on `port`.
///
/// Probes up to `MAX_SWEEP_HOSTS` hosts concurrently (one per host-octet,
/// 1-254) and returns every responding node sorted by ascending latency.
/// The caller's own address is always excluded.
pub async fn discover_lan(port: Option<u16>) -> Vec<DiscoveredNode> {
    // An explicit port means "only this one". Otherwise sweep EVERY profile's
    // port, so a stable client can discover a canary node.
    let ports: Vec<u16> = match port {
        Some(p) => vec![p],
        None => PROFILE_PORTS.iter().map(|(_, p)| *p).collect(),
    };
    let own_ip = local_ipv4().unwrap_or_default();
    let prefix = match local_ipv4().and_then(|ip| subnet_prefix(&ip)) {
        Some(p) => p,
        None => return vec![],
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(PROBE_TIMEOUT_MS))
        .build()
        .unwrap_or_default();

    let mut tasks = tokio::task::JoinSet::new();
    for port in ports {
        // Localhost first: the common case is a second profile on THIS machine,
        // which the /24 sweep skips because it excludes our own address.
        let c = client.clone();
        tasks.spawn(async move {
            let latency = probe(&c, "127.0.0.1", port).await;
            ("127.0.0.1".to_string(), port, latency)
        });
        for host_octet in 1u8..=MAX_SWEEP_HOSTS {
            let host = format!("{prefix}.{host_octet}");
            if host == own_ip {
                continue;
            }
            let c = client.clone();
            tasks.spawn(async move {
                let latency = probe(&c, &host, port).await;
                (host, port, latency)
            });
        }
    }

    let mut found: Vec<DiscoveredNode> = Vec::new();
    while let Some(Ok((host, port, Some(latency_ms)))) = tasks.join_next().await {
        found.push(DiscoveredNode {
            url: format!("http://{host}:{port}"),
            latency_ms,
        });
    }

    // The same Core can answer on both 127.0.0.1 and this host's LAN address.
    found.sort_by(|a, b| a.url.cmp(&b.url));
    found.dedup_by(|a, b| a.url == b.url);
    found.sort_by_key(|n| n.latency_ms);
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_config() -> NodesConfig {
        NodesConfig {
            default: "local".into(),
            nodes: vec![
                Node {
                    name: "local".into(),
                    url: "http://127.0.0.1:2049".into(),
                    token: None,
                    mesh: None,
                },
                Node {
                    name: "pi".into(),
                    url: "http://192.168.1.5:2049".into(),
                    token: Some("ryu_abc".into()),
                    mesh: None,
                },
            ],
        }
    }

    #[test]
    fn active_node_returns_default() {
        let config = make_config();
        let node = resolve_active_node(&config);
        assert_eq!(node.name, "local");
        assert_eq!(node.url, "http://127.0.0.1:2049");
    }

    #[test]
    fn active_node_falls_back_when_default_missing() {
        let config = NodesConfig {
            default: "nonexistent".into(),
            nodes: vec![Node {
                name: "local".into(),
                url: "http://127.0.0.1:2049".into(),
                token: None,
                mesh: None,
            }],
        };
        let node = resolve_active_node(&config);
        assert_eq!(node.name, "local");
    }

    #[test]
    fn get_node_finds_by_name() {
        let config = make_config();
        let pi = resolve_node_by_name(&config, "pi").unwrap();
        assert_eq!(pi.token, Some("ryu_abc".into()));
    }

    #[test]
    fn get_node_returns_error_when_missing() {
        let config = make_config();
        let result = resolve_node_by_name(&config, "does-not-exist");
        assert!(result.is_err());
    }

    #[test]
    fn default_config_has_local() {
        let config = default_config();
        assert_eq!(config.default, "local");
        assert_eq!(config.nodes.len(), 1);
        assert_eq!(config.nodes[0].name, "local");
        assert!(config.nodes[0].token.is_none());
    }

    #[test]
    fn select_preferred_picks_reachable_remote() {
        let nodes = vec![
            Node {
                name: "local".into(),
                url: "http://127.0.0.1:2049".into(),
                token: None,
                mesh: None,
            },
            Node {
                name: "pi".into(),
                url: "http://192.168.1.5:2049".into(),
                token: Some("tok".into()),
                mesh: None,
            },
        ];
        // local unreachable, remote reachable
        let chosen = select_preferred(&nodes, &[false, true]);
        assert_eq!(chosen.name, "pi");
    }

    #[test]
    fn select_preferred_falls_back_to_local_when_no_remote_reachable() {
        let nodes = vec![
            Node {
                name: "local".into(),
                url: "http://127.0.0.1:2049".into(),
                token: None,
                mesh: None,
            },
            Node {
                name: "pi".into(),
                url: "http://192.168.1.5:2049".into(),
                token: Some("tok".into()),
                mesh: None,
            },
        ];
        // both unreachable — must fall back to local
        let chosen = select_preferred(&nodes, &[false, false]);
        assert_eq!(chosen.name, "local");
    }

    #[test]
    fn node_without_mesh_deserializes() {
        // A legacy nodes.json (no `mesh` key) must still parse, with mesh = None.
        let json = r#"{ "name": "pi", "url": "http://192.168.1.5:7980", "token": "ryu_x" }"#;
        let node: Node = serde_json::from_str(json).expect("legacy node deserializes");
        assert_eq!(node.name, "pi");
        assert_eq!(node.token.as_deref(), Some("ryu_x"));
        assert!(node.mesh.is_none());
    }

    #[test]
    fn node_with_mesh_deserializes() {
        let json = r#"{ "name": "pi", "url": "http://ryu-pi:7980", "token": null,
            "mesh": { "socks5": "127.0.0.1:1055", "magic_dns_name": "ryu-pi.ts.net" } }"#;
        let node: Node = serde_json::from_str(json).expect("mesh node deserializes");
        let mesh = node.mesh.expect("mesh present");
        assert_eq!(mesh.socks5, "127.0.0.1:1055");
        assert_eq!(mesh.magic_dns_name.as_deref(), Some("ryu-pi.ts.net"));
    }

    #[test]
    fn mesh_client_builds() {
        // Plain node (no mesh) → a client builds without a proxy.
        let plain = Node {
            name: "local".into(),
            url: "http://127.0.0.1:7980".into(),
            token: None,
            mesh: None,
        };
        assert!(plain.mesh_client().is_ok());

        // Mesh node → a socks5h:// proxied client builds.
        let meshed = Node {
            name: "pi".into(),
            url: "http://ryu-pi:7980".into(),
            token: None,
            mesh: Some(MeshAddr {
                socks5: "127.0.0.1:1055".into(),
                magic_dns_name: Some("ryu-pi.ts.net".into()),
            }),
        };
        assert!(meshed.mesh_client().is_ok());
    }

    #[test]
    fn select_preferred_ignores_reachable_local_picks_remote() {
        let nodes = vec![
            Node {
                name: "local".into(),
                url: "http://127.0.0.1:2049".into(),
                token: None,
                mesh: None,
            },
            Node {
                name: "remote".into(),
                url: "http://10.0.0.1:2049".into(),
                token: None,
                mesh: None,
            },
        ];
        // both reachable — should still prefer the non-local remote
        let chosen = select_preferred(&nodes, &[true, true]);
        assert_eq!(chosen.name, "remote");
    }

    /// `apps/cli` deliberately does not depend on Core, so PROFILE_PORTS is a
    /// hand-copied mirror of `apps/core/src/profile.rs`'s PROFILE_PORT_OFFSETS.
    /// Pin the values, or the table drifts silently and discovery quietly stops
    /// finding a profile.
    #[test]
    fn profile_ports_match_cores_table() {
        assert_eq!(
            PROFILE_PORTS,
            [
                ("release", 7980u16),
                ("dev", 8980),
                ("canary", 9980),
                ("nightly", 10_980),
                ("beta", 11_980),
            ]
        );
        // The release entry must equal the single-port default, or an explicit
        // `--port` sweep and the default sweep would disagree about release.
        assert_eq!(PROFILE_PORTS[0].1, CORE_PORT);
    }

    /// Two profiles sharing a port would be reported as one node.
    #[test]
    fn every_profile_port_is_distinct() {
        let mut ports: Vec<u16> = PROFILE_PORTS.iter().map(|(_, p)| *p).collect();
        let n = ports.len();
        ports.sort_unstable();
        ports.dedup();
        assert_eq!(ports.len(), n);
    }

    #[test]
    fn local_node_url_detection_resists_the_userinfo_bypass() {
        // Loopback spellings Core actually binds.
        assert!(is_local_node_url("http://127.0.0.1:7980"));
        assert!(is_local_node_url("http://localhost:7980"));
        assert!(is_local_node_url("http://LOCALHOST:7980/"));
        assert!(is_local_node_url("http://[::1]:7980"));
        assert!(is_local_node_url("http://localhost.:7980"));

        // THE LEAK: `localhost:80` here is USERINFO — the real authority is
        // evil.com. Splitting on the last `:` reads the host as `localhost` and
        // would hand this machine's node token to evil.com.
        assert!(!is_local_node_url("http://localhost:80@evil.com/"));
        assert!(!is_local_node_url("http://127.0.0.1@evil.com/"));
        assert!(!is_local_node_url("http://user:pass@evil.com/"));

        // Lookalikes and junk fail closed.
        assert!(!is_local_node_url("http://127.0.0.1.evil.com/"));
        assert!(!is_local_node_url("http://localhost.evil.com/"));
        assert!(!is_local_node_url("http://192.168.1.50:7980"));
        assert!(!is_local_node_url("not a url"));
        assert!(!is_local_node_url(""));
    }

    #[test]
    fn fill_local_token_never_hands_a_remote_node_this_machines_secret() {
        let mut config = NodesConfig {
            default: "local".into(),
            nodes: vec![
                Node {
                    name: "remote".into(),
                    url: "http://192.168.1.50:7980".into(),
                    token: None,
                    mesh: None,
                },
                Node {
                    name: "spoofed".into(),
                    url: "http://localhost:80@evil.com/".into(),
                    token: None,
                    mesh: None,
                },
            ],
        };
        fill_local_token(&mut config);
        assert_eq!(config.nodes[0].token, None);
        assert_eq!(config.nodes[1].token, None);
    }
}
