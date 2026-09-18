//! Private local Gateway credentials shared by the standalone and Core hosts.
use anyhow::{bail, Context, Result};
use std::{
    fs::OpenOptions,
    io::{Read, Write},
    path::Path,
};

/// Bearers are opaque printable values; reject empty values and public dev placeholders.
pub fn validate(key: &str) -> Result<()> {
    if key.len() < 24
        || !key.bytes().all(|b| b.is_ascii_graphic())
        || matches!(key, "ryu-local" | "changeme" | "password")
    {
        bail!("Gateway credentials must contain at least 24 non-whitespace printable characters");
    }
    Ok(())
}

fn read_private(path: &Path) -> Result<String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(path)
        .with_context(|| format!("cannot read credential {}", path.display()))?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        bail!("credential must be a regular file");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.mode() & 0o077 != 0 || metadata.uid() != unsafe { libc::geteuid() } {
            bail!(
                "credential {} must be owned by the current user and have owner-only permissions",
                path.display()
            );
        }
    }
    if metadata.len() > 4096 {
        bail!("credential file is too large");
    }
    let mut key = String::new();
    file.read_to_string(&mut key)?;
    let key = key.trim().to_owned();
    validate(&key)?;
    Ok(key)
}

/// Publish a complete private file without replacing an existing credential.
/// Concurrent bootstrap callers converge on the same persisted key.
pub fn load_or_create(path: &Path, prefix: &str) -> Result<String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                bail!("credential path must not be a symlink");
            }
            return read_private(path);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let parent = path.parent().context("credential path has no parent")?;
    std::fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".gateway-key-{}", uuid::Uuid::new_v4().simple()));
    let key = format!("{prefix}{}", uuid::Uuid::new_v4().simple());
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| -> Result<()> {
        let mut file = options.open(&temporary)?;
        file.write_all(key.as_bytes())?;
        file.sync_all()?;
        match std::fs::hard_link(&temporary, path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
            Err(error) => Err(error.into()),
        }
    })();
    let _ = std::fs::remove_file(&temporary);
    result?;
    read_private(path)
}

/// Core-issued inference identity. The recipient can replay its own scope but
/// cannot choose another agent, user or session without Core's signing secret.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InferenceScope {
    pub agent_id: String,
    pub user_id: Option<String>,
    pub session_id: Option<String>,
    /// Unix timestamp after which the scoped credential must be rejected.
    pub expires_at: u64,
}

impl InferenceScope {
    fn validate(&self) -> Result<()> {
        for value in [
            Some(self.agent_id.as_str()),
            self.user_id.as_deref(),
            self.session_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if value.is_empty()
                || value.trim() != value
                || value.len() > 256
                || value.chars().any(char::is_control)
            {
                bail!("invalid scoped inference identity");
            }
        }
        if self.expires_at <= unix_now() {
            bail!("scoped inference credential is expired");
        }
        Ok(())
    }

    pub fn sign(&self, core_key: &str) -> Result<String> {
        use hmac::Mac;
        self.validate()?;
        let payload = hex::encode(serde_json::to_vec(self)?);
        let signed = format!("gws1.{payload}");
        let mut mac = hmac::Hmac::<sha2::Sha256>::new_from_slice(core_key.as_bytes())?;
        mac.update(signed.as_bytes());
        Ok(format!(
            "{signed}.{}",
            hex::encode(mac.finalize().into_bytes())
        ))
    }

    pub fn verify(token: &str, core_key: &str) -> Result<Self> {
        use hmac::Mac;
        if token.len() > 4096 {
            bail!("scoped inference credential is too large");
        }
        let (signed, signature) = token
            .rsplit_once('.')
            .context("invalid scoped inference credential")?;
        let payload = signed
            .strip_prefix("gws1.")
            .context("invalid scoped inference version")?;
        let mut mac = hmac::Hmac::<sha2::Sha256>::new_from_slice(core_key.as_bytes())?;
        mac.update(signed.as_bytes());
        mac.verify_slice(&hex::decode(signature)?)
            .map_err(|_| anyhow::anyhow!("invalid scoped inference signature"))?;
        let scope: Self = serde_json::from_slice(&hex::decode(payload)?)?;
        scope.validate()?;
        Ok(scope)
    }
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(u64::MAX)
}

pub fn fingerprint(key: &str) -> String {
    use sha2::Digest;
    hex::encode(sha2::Sha256::digest(key.as_bytes()))
}

/// Signed, non-secret startup facts. Listener is the bound socket address supplied
/// by the host after TcpListener::bind, never a caller-controlled HTTP authority.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct Readiness {
    pub protocol: String,
    pub version: String,
    pub nonce: String,
    pub listener: std::net::SocketAddr,
    pub require_auth: bool,
    pub inference_keys: Vec<String>,
    pub core_keys: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ReadinessProof {
    pub readiness: Readiness,
    pub signature: String,
}

impl ReadinessProof {
    pub fn sign(readiness: Readiness, admin: &str) -> Result<Self> {
        use hmac::Mac;
        let mut mac = hmac::Hmac::<sha2::Sha256>::new_from_slice(admin.as_bytes())?;
        mac.update(&serde_json::to_vec(&readiness)?);
        Ok(Self {
            readiness,
            signature: hex::encode(mac.finalize().into_bytes()),
        })
    }

    pub fn verify(
        &self,
        admin: &str,
        nonce: &str,
        listener: std::net::SocketAddr,
        version: &str,
        relay: &str,
        core: &str,
    ) -> Result<()> {
        use hmac::Mac;
        let mut mac = hmac::Hmac::<sha2::Sha256>::new_from_slice(admin.as_bytes())?;
        mac.update(&serde_json::to_vec(&self.readiness)?);
        mac.verify_slice(&hex::decode(&self.signature)?)
            .map_err(|_| anyhow::anyhow!("Gateway readiness signature is invalid"))?;
        let ready = &self.readiness;
        if ready.protocol != "ryu-gateway-readiness-v1"
            || ready.nonce != nonce
            || ready.listener != listener
            || ready.version != version
            || !ready.require_auth
        {
            bail!("Gateway readiness does not match this listener, nonce, version, or authenticated configuration");
        }
        let relay = fingerprint(relay);
        let core = fingerprint(core);
        let admin = fingerprint(admin);
        if relay == core
            || relay == admin
            || core == admin
            || !ready.inference_keys.contains(&relay)
            || !ready.core_keys.contains(&core)
            || ready.core_keys.contains(&relay)
            || ready.inference_keys.contains(&core)
            || ready.inference_keys.contains(&admin)
            || ready.core_keys.contains(&admin)
        {
            bail!("Gateway readiness credential roles do not match the managed configuration");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persists_distinct_private_keys_and_rejects_invalid_existing_files() {
        let dir = std::env::temp_dir().join(format!("ryu-credentials-{}", uuid::Uuid::new_v4()));
        let path = dir.join("relay.key");
        let key = load_or_create(&path, "gwrelay_").unwrap();
        assert_eq!(load_or_create(&path, "gwrelay_").unwrap(), key);
        assert_ne!(
            load_or_create(&dir.join("admin.key"), "gwadm_").unwrap(),
            key
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
            assert!(load_or_create(&path, "gwrelay_").is_err());
            let link = dir.join("link.key");
            std::os::unix::fs::symlink(&path, &link).unwrap();
            assert!(load_or_create(&link, "gwrelay_").is_err());
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rejects_blank_short_and_header_injection_values() {
        for key in [
            "",
            "ryu-local",
            "operator-key",
            "abcdefghijklmnopqrstuvwx\n",
        ] {
            assert!(validate(key).is_err());
        }
        assert!(validate("gwrelay_0123456789abcdef0123456789abcdef").is_ok());
    }
    #[test]
    fn concurrent_bootstrap_converges_and_storage_failure_is_fatal() {
        let directory = std::env::temp_dir().join(format!("ryu-key-race-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("relay.key");
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let path = path.clone();
                std::thread::spawn(move || load_or_create(&path, "gwrelay_").unwrap())
            })
            .collect();
        let keys: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert!(keys.iter().all(|key| key == &keys[0]));
        let blocked = directory.join("not-a-directory");
        std::fs::write(&blocked, b"block").unwrap();
        assert!(load_or_create(&blocked.join("key"), "gwrelay_").is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn readiness_binds_nonce_socket_version_and_roles() {
        let readiness = Readiness {
            protocol: "ryu-gateway-readiness-v1".into(),
            version: "1".into(),
            nonce: "nonce".into(),
            listener: "127.0.0.1:1234".parse().unwrap(),
            require_auth: true,
            inference_keys: vec![fingerprint("relay")],
            core_keys: vec![fingerprint("core")],
        };
        let proof = ReadinessProof::sign(readiness, "admin").unwrap();
        assert!(proof
            .verify(
                "admin",
                "nonce",
                "127.0.0.1:1234".parse().unwrap(),
                "1",
                "relay",
                "core"
            )
            .is_ok());
        assert!(proof
            .verify(
                "wrong",
                "nonce",
                "127.0.0.1:1234".parse().unwrap(),
                "1",
                "relay",
                "core"
            )
            .is_err());
        assert!(proof
            .verify(
                "admin",
                "other-nonce",
                "127.0.0.1:1234".parse().unwrap(),
                "1",
                "relay",
                "core"
            )
            .is_err());
        assert!(proof
            .verify(
                "admin",
                "nonce",
                "127.0.0.1:5678".parse().unwrap(),
                "1",
                "relay",
                "core"
            )
            .is_err());
        assert!(proof
            .verify(
                "admin",
                "nonce",
                "127.0.0.1:1234".parse().unwrap(),
                "2",
                "relay",
                "core"
            )
            .is_err());
        assert!(proof
            .verify(
                "admin",
                "nonce",
                "127.0.0.1:1234".parse().unwrap(),
                "1",
                "core",
                "relay"
            )
            .is_err());
    }
    #[test]
    fn scoped_inference_identity_cannot_be_changed_by_its_recipient() {
        let scope = InferenceScope {
            agent_id: "agent-a".into(),
            user_id: Some("user-a".into()),
            session_id: Some("session-a".into()),
            expires_at: unix_now() + 3600,
        };
        let token = scope.sign("core-only-signing-key").unwrap();
        assert_eq!(
            InferenceScope::verify(&token, "core-only-signing-key").unwrap(),
            scope
        );
        assert!(InferenceScope::verify(&token, "exported-inference-relay").is_err());
        let mut other = scope.clone();
        other.agent_id = "agent-b".into();
        let payload = hex::encode(serde_json::to_vec(&other).unwrap());
        let (_, signature) = token.rsplit_once('.').unwrap();
        assert!(InferenceScope::verify(
            &format!("gws1.{payload}.{signature}"),
            "core-only-signing-key"
        )
        .is_err());
        other.agent_id = " ".into();
        assert!(other.sign("core-only-signing-key").is_err());
    }

    #[test]
    fn scoped_inference_credentials_expire() {
        let scope = InferenceScope {
            agent_id: "agent-a".into(),
            user_id: None,
            session_id: None,
            expires_at: unix_now().saturating_sub(1),
        };
        assert!(scope.sign("core-only-signing-key").is_err());
    }
}
