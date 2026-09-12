use std::{path::Path, sync::Arc, time::Duration};

use anyhow::{ensure, Context, Result};
use futures_util::TryStreamExt;
use object_store::{
    aws::AmazonS3Builder, buffered::BufWriter, path::Path as ObjectPath, ClientOptions,
    ObjectStore, RetryConfig,
};
use tokio::io::AsyncWriteExt;

use crate::{encryption, BackupDestination, BackupRecord, BackupScope, SaveBackupDestination};

pub const MAX_CATALOG_ENTRIES: usize = 2000;

#[derive(Debug)]
struct BackupConnector {
    allow_http: bool,
}

impl object_store::client::HttpConnector for BackupConnector {
    fn connect(
        &self,
        _options: &ClientOptions,
    ) -> object_store::Result<object_store::client::HttpClient> {
        let client = reqwest::Client::builder()
            .https_only(!self.allow_http)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|source| object_store::Error::Generic {
                store: "S3 backup",
                source: Box::new(source),
            })?;
        Ok(object_store::client::HttpClient::new(client))
    }
}

pub fn validate(request: &SaveBackupDestination) -> Result<()> {
    ensure!(
        !request.name.trim().is_empty() && request.name.len() <= 120,
        "Destination name must contain 1–120 bytes"
    );
    let endpoint = url::Url::parse(&request.endpoint).context("Invalid S3 endpoint")?;
    ensure!(
        endpoint.scheme() == "https" || (endpoint.scheme() == "http" && request.allow_http),
        "Use HTTPS, or explicitly allow HTTP for a trusted S3 server"
    );
    ensure!(endpoint.host_str().is_some() && endpoint.username().is_empty() && endpoint.password().is_none()
        && endpoint.query().is_none() && endpoint.fragment().is_none() && endpoint.path() == "/", "Endpoint must contain only scheme, host and optional port, without a bucket or credentials");
    if let Some(host) = endpoint.host_str() {
        ensure!(
            host != "metadata.google.internal"
                && host != "169.254.169.254"
                && host != "[fd00:ec2::254]",
            "Cloud metadata endpoints are not S3 destinations"
        );
        if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
            ensure!(
                !ip.is_link_local() && !ip.is_unspecified() && !ip.is_multicast(),
                "Invalid S3 destination address"
            );
        }
    }
    ensure!(
        (3..=63).contains(&request.bucket.len())
            && request
                .bucket
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.')
            && request.bucket.as_bytes()[0].is_ascii_alphanumeric()
            && request.bucket.as_bytes()[request.bucket.len() - 1].is_ascii_alphanumeric(),
        "Invalid S3 bucket name"
    );
    ensure!(
        !request.region.is_empty()
            && request.region.len() <= 64
            && request
                .region
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-'),
        "Invalid S3 region; use auto for R2"
    );
    ensure!(
        request.prefix.len() <= 256
            && request.prefix.trim_matches('/').split('/').all(|p| {
                p.is_empty()
                    || (p != "."
                        && p != ".."
                        && p.bytes()
                            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.')))
            }),
        "Prefix must use safe slash-separated names"
    );
    ensure!(
        !request.access_key_id.is_empty()
            && request.access_key_id.len() <= 256
            && !request.secret_access_key.is_empty()
            && request.secret_access_key.len() <= 1024,
        "S3 access key and secret are required"
    );
    ensure!(
        request
            .session_token
            .as_ref()
            .is_none_or(|v| v.len() <= 8192),
        "Session token is too long"
    );
    ensure!(
        request.allowed_apps.len() <= 100
            && request.allowed_apps.iter().all(|v| !v.is_empty()
                && v.len() <= 128
                && v.bytes()
                    .all(|b| b.is_ascii_alphanumeric()
                        || matches!(b, b'.' | b'-' | b'_' | b'@' | b'/'))),
        "Invalid allowed app IDs"
    );
    encryption::parse_key(&request.recovery_key)?;
    Ok(())
}

#[derive(Clone)]
pub struct S3BackupStore {
    store: Arc<dyn ObjectStore>,
    prefix: String,
    key: [u8; 32],
}

impl S3BackupStore {
    pub fn new(
        destination: &BackupDestination,
        access_key: &str,
        secret: &str,
        session_token: Option<&str>,
        key: [u8; 32],
    ) -> Result<Self> {
        let mut endpoint = url::Url::parse(&destination.endpoint)?;
        if !destination.path_style {
            let host = format!(
                "{}.{}",
                destination.bucket,
                endpoint.host_str().context("Missing endpoint host")?
            );
            endpoint.set_host(Some(&host))?;
        }
        let mut builder = AmazonS3Builder::new()
            .with_http_connector(BackupConnector {
                allow_http: destination.allow_http,
            })
            .with_endpoint(endpoint.as_str().trim_end_matches('/'))
            .with_bucket_name(&destination.bucket)
            .with_region(&destination.region)
            .with_access_key_id(access_key)
            .with_secret_access_key(secret)
            .with_virtual_hosted_style_request(!destination.path_style)
            .with_allow_http(destination.allow_http)
            .with_client_options(
                ClientOptions::new()
                    .with_allow_http(destination.allow_http)
                    .with_timeout(Duration::from_secs(120))
                    .with_connect_timeout(Duration::from_secs(10)),
            )
            .with_retry(RetryConfig {
                max_retries: 2,
                retry_timeout: Duration::from_secs(180),
                ..Default::default()
            });
        if let Some(token) = session_token.filter(|token| !token.trim().is_empty()) {
            builder = builder.with_token(token);
        }
        let prefix = format!("{}/ryu-backups/v1", destination.prefix.trim_matches('/'))
            .trim_start_matches('/')
            .to_owned();
        Ok(Self {
            store: Arc::new(builder.build()?),
            prefix,
            key,
        })
    }

    pub fn object_key(&self, id: &str) -> Result<String> {
        uuid::Uuid::parse_str(id).context("Invalid backup ID")?;
        Ok(format!("{}/{id}.ryubak", self.prefix))
    }

    fn record_path(&self, id: &str) -> Result<ObjectPath> {
        self.object_key(id)?;
        Ok(ObjectPath::from(format!("{}/{id}.record", self.prefix)))
    }

    /// Verifies write/read/list/delete with a unique, disposable encrypted probe.
    pub async fn test(&self) -> Result<()> {
        let path = ObjectPath::from(format!("{}/probes/{}", self.prefix, uuid::Uuid::new_v4()));
        let probe = b"Ryu S3 backup connection test";
        self.store
            .put(&path, probe.to_vec().into())
            .await
            .context("S3 write test failed")?;
        let read_result: Result<()> = async {
            let result = self.store.get(&path).await.context("S3 read test failed")?;
            ensure!(
                result.meta.size == probe.len() as u64,
                "S3 probe has incorrect length"
            );
            ensure!(
                result.bytes().await?.as_ref() == probe,
                "S3 probe did not round-trip"
            );
            let prefix = ObjectPath::from(format!("{}/probes", self.prefix));
            let mut listing = self.store.list(Some(&prefix));
            let mut found = false;
            let mut scanned = 0usize;
            while let Some(object) = listing.try_next().await.context("S3 list test failed")? {
                scanned += 1;
                ensure!(
                    scanned <= MAX_CATALOG_ENTRIES,
                    "Too many stale S3 connection probes"
                );
                if object.location == path {
                    found = true;
                    break;
                }
            }
            ensure!(found, "S3 probe was not listed");
            Ok(())
        }
        .await;
        let cleanup = self
            .store
            .delete(&path)
            .await
            .context("S3 delete test failed; remove the connection-test probe manually");
        read_result?;
        cleanup?;
        Ok(())
    }

    pub async fn upload(&self, file: &Path, record: &BackupRecord) -> Result<()> {
        ensure!(
            record.object_key == self.object_key(&record.id)?,
            "Invalid backup object key"
        );
        let mut input = tokio::fs::File::open(file).await?;
        let mut output = BufWriter::with_capacity(
            self.store.clone(),
            ObjectPath::from(record.object_key.clone()),
            8 * 1024 * 1024,
        )
        .with_max_concurrency(2);
        if let Err(error) = tokio::io::copy(&mut input, &mut output).await {
            let _ = output.abort().await;
            return Err(error).context("S3 backup upload failed");
        }
        if let Err(error) = output.shutdown().await {
            return Err(error).context("S3 backup upload did not finish");
        }
        let metadata = serde_json::to_vec(record)?;
        let mut encrypted = Vec::new();
        encryption::encrypt(
            metadata.as_slice(),
            &mut encrypted,
            metadata.len() as u64,
            &self.key,
        )?;
        // The authenticated catalog record is published last, so partial uploads
        // cannot be listed as successful backups or trigger retention.
        if let Err(error) = self
            .store
            .put(&self.record_path(&record.id)?, encrypted.into())
            .await
        {
            let _ = self
                .store
                .delete(&ObjectPath::from(record.object_key.clone()))
                .await;
            return Err(error).context("S3 backup catalog publication failed");
        }
        Ok(())
    }

    pub async fn record(&self, id: &str) -> Result<BackupRecord> {
        let object = self
            .store
            .get(&self.record_path(id)?)
            .await
            .context("Backup record is unavailable")?;
        ensure!(object.meta.size <= 16 * 1024, "Backup record is too large");
        let bytes = object.bytes().await?;
        let mut decoded = Vec::new();
        encryption::decrypt(bytes.as_ref(), &mut decoded, &self.key)?;
        let record: BackupRecord = serde_json::from_slice(&decoded)?;
        ensure!(
            record.version == 1
                && record.id == id
                && record.object_key == self.object_key(id)?
                && record.bytes <= crate::archive::MAX_ARCHIVE_BYTES + 32 * 1024 * 1024,
            "Invalid backup record"
        );
        Ok(record)
    }

    pub async fn list(&self, scope: Option<&BackupScope>) -> Result<Vec<BackupRecord>> {
        let prefix = ObjectPath::from(self.prefix.clone());
        let mut listing = self.store.list(Some(&prefix));
        let mut records = Vec::new();
        let mut scanned = 0;
        while let Some(object) = listing.try_next().await? {
            scanned += 1;
            ensure!(
                scanned <= MAX_CATALOG_ENTRIES * 3,
                "Backup catalog is too large; use a more specific destination prefix"
            );
            let Some(id) = object
                .location
                .as_ref()
                .strip_prefix(&format!("{}/", self.prefix))
                .and_then(|v| v.strip_suffix(".record"))
            else {
                continue;
            };
            if uuid::Uuid::parse_str(id).is_err() {
                continue;
            }
            let record = self.record(id).await?;
            if scope.is_none_or(|scope| scope == &record.scope) {
                records.push(record);
            }
        }
        records.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| b.id.cmp(&a.id))
        });
        Ok(records)
    }

    pub async fn download(&self, record: &BackupRecord, destination: &Path) -> Result<()> {
        ensure!(
            record.object_key == self.object_key(&record.id)?,
            "Invalid backup object key"
        );
        let result = self
            .store
            .get(&ObjectPath::from(record.object_key.clone()))
            .await?;
        ensure!(
            result.meta.size == record.bytes,
            "Backup size verification failed"
        );
        let mut stream = result.into_stream();
        let mut output = tokio::fs::File::create(destination).await?;
        let mut bytes = 0u64;
        while let Some(chunk) = stream.try_next().await? {
            bytes = bytes
                .checked_add(chunk.len() as u64)
                .context("Backup size overflow")?;
            ensure!(bytes <= record.bytes, "Backup exceeds its recorded size");
            output.write_all(&chunk).await?;
        }
        output.sync_all().await?;
        ensure!(bytes == record.bytes, "Backup download is incomplete");
        let path = destination.to_owned();
        let hash =
            tokio::task::spawn_blocking(move || encryption::sha256(std::fs::File::open(path)?))
                .await??;
        ensure!(hash == record.sha256, "Backup checksum verification failed");
        Ok(())
    }

    pub async fn delete(&self, record: &BackupRecord) -> Result<()> {
        ensure!(
            record.object_key == self.object_key(&record.id)?,
            "Invalid backup object key"
        );
        self.store
            .delete(&ObjectPath::from(record.object_key.clone()))
            .await?;
        self.store.delete(&self.record_path(&record.id)?).await?;
        Ok(())
    }

    pub fn recovery_key(&self) -> &[u8; 32] {
        &self.key
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_provider_config_and_rejects_credential_urls() {
        let mut input = SaveBackupDestination {
            name: "R2".into(),
            endpoint: "https://account.r2.cloudflarestorage.com".into(),
            bucket: "backup-bucket".into(),
            region: "auto".into(),
            prefix: "ryu/production".into(),
            path_style: true,
            allow_http: false,
            allowed_apps: vec![],
            access_key_id: "access".into(),
            secret_access_key: "secret".into(),
            session_token: None,
            recovery_key: encryption::new_key(),
        };
        validate(&input).unwrap();
        for endpoint in [
            "https://user:pass@host",
            "https://host/bucket",
            "http://host",
            "https://169.254.169.254",
            "https://host?secret=1",
        ] {
            input.endpoint = endpoint.into();
            assert!(validate(&input).is_err(), "{endpoint}");
        }
    }
}
