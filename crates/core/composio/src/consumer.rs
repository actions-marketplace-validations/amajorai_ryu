//! At-least-once Connect inbox consumption. The handler must authorize targets,
//! treat payloads as untrusted, and durably deduplicate by delivery ID. Dropping
//! a handler future cannot undo side effects already issued to another service.
use anyhow::{bail, Context, Result};
use std::time::Duration;

use crate::service::{self, EventLease};

#[async_trait::async_trait]
pub trait EventHandler: Send + Sync {
    /// Return success only after durable handling. Never receive the lease token.
    async fn handle(
        &self,
        owner_user_id: &str,
        delivery_id: &str,
        payload: &serde_json::Value,
    ) -> Result<()>;
}

#[derive(Debug, PartialEq, Eq)]
pub enum Consumption {
    Empty,
    Acknowledged { delivery_id: String },
}

/// Stable checkpoint identity, not an authentication credential. Delimit with
/// JSON so concatenated owner/delivery/target strings cannot alias each other.
pub fn execution_id(owner: &str, delivery: &str, target: &str) -> Result<String> {
    for value in [owner, delivery, target] {
        if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
            bail!("Invalid Connect execution identity");
        }
    }
    let identity = serde_json::to_vec(&(owner, delivery, target))?;
    Ok(format!(
        "connectrun_{}",
        ryu_crypto::hmac_sha256_hex(b"ryu-connect-execution-v1", &identity)
    ))
}

#[async_trait::async_trait]
trait Inbox: Send + Sync {
    async fn claim(&self) -> Result<Option<EventLease>>;
    async fn renew(&self, lease: &EventLease) -> Result<bool>;
    async fn acknowledge(&self, lease: &EventLease) -> Result<bool>;
}

struct RemoteInbox<'a> {
    user_id: Option<&'a str>,
}

#[async_trait::async_trait]
impl Inbox for RemoteInbox<'_> {
    async fn claim(&self) -> Result<Option<EventLease>> {
        service::claim_event(self.user_id)
            .await
            .context("Connect event inbox is not configured")?
    }
    async fn renew(&self, lease: &EventLease) -> Result<bool> {
        service::renew_event(lease, self.user_id)
            .await
            .context("Connect event inbox is not configured")?
    }
    async fn acknowledge(&self, lease: &EventLease) -> Result<bool> {
        service::acknowledge_event(lease, self.user_id)
            .await
            .context("Connect event inbox is not configured")?
    }
}

pub async fn consume_one(user_id: Option<&str>, handler: &dyn EventHandler) -> Result<Consumption> {
    consume_with(
        &RemoteInbox { user_id },
        user_id.unwrap_or("local"),
        handler,
        Duration::from_secs(10),
    )
    .await
}

async fn consume_with(
    inbox: &dyn Inbox,
    owner_user_id: &str,
    handler: &dyn EventHandler,
    renewal_interval: Duration,
) -> Result<Consumption> {
    let Some(lease) = inbox.claim().await? else {
        return Ok(Consumption::Empty);
    };
    let handling = handler.handle(owner_user_id, &lease.delivery_id, &lease.payload);
    tokio::pin!(handling);
    let mut renewal = tokio::time::interval_at(
        tokio::time::Instant::now() + renewal_interval,
        renewal_interval,
    );
    renewal.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            result = &mut handling => {
                result.context("Connect event handling failed")?;
                if !inbox.acknowledge(&lease).await? {
                    bail!("Connect event acknowledgment rejected; lease ownership was lost");
                }
                return Ok(Consumption::Acknowledged { delivery_id: lease.delivery_id.clone() });
            }
            _ = renewal.tick() => {
                if !inbox.renew(&lease).await? {
                    bail!("Connect event renewal rejected; stopping handler");
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execution_identity_is_stable_and_scoped() {
        let id = execution_id("owner", "delivery", "target").unwrap();
        assert_eq!(id, execution_id("owner", "delivery", "target").unwrap());
        assert_ne!(id, execution_id("other", "delivery", "target").unwrap());
        assert_ne!(id, execution_id("owner", "other", "target").unwrap());
        assert_ne!(id, execution_id("owner", "delivery", "other").unwrap());
        assert_ne!(
            execution_id("ab", "c", "d").unwrap(),
            execution_id("a", "bc", "d").unwrap()
        );
        assert!(execution_id("", "delivery", "target").is_err());
    }
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use tokio::sync::Notify;

    struct FakeInbox {
        empty: bool,
        renew_ok: bool,
        renew_error: bool,
        ack_ok: bool,
        renewals: AtomicUsize,
        acknowledgments: AtomicUsize,
        renewed: Arc<Notify>,
    }
    impl FakeInbox {
        fn new() -> Self {
            Self {
                empty: false,
                renew_ok: true,
                renew_error: false,
                ack_ok: true,
                renewals: AtomicUsize::new(0),
                acknowledgments: AtomicUsize::new(0),
                renewed: Arc::new(Notify::new()),
            }
        }
    }
    #[async_trait::async_trait]
    impl Inbox for FakeInbox {
        async fn claim(&self) -> Result<Option<EventLease>> {
            if self.empty {
                return Ok(None);
            }
            Ok(Some(serde_json::from_value(
                serde_json::json!({"deliveryId":"delivery-a","leaseToken":"00000000-0000-4000-8000-000000000001","payload":{"data":"fixture"}}),
            )?))
        }
        async fn renew(&self, _: &EventLease) -> Result<bool> {
            self.renewals.fetch_add(1, Ordering::SeqCst);
            self.renewed.notify_one();
            if self.renew_error {
                bail!("fixture transport failure");
            }
            Ok(self.renew_ok)
        }
        async fn acknowledge(&self, _: &EventLease) -> Result<bool> {
            self.acknowledgments.fetch_add(1, Ordering::SeqCst);
            Ok(self.ack_ok)
        }
    }
    struct Handler {
        wait: Option<Arc<Notify>>,
        fail: bool,
        calls: AtomicUsize,
    }
    #[async_trait::async_trait]
    impl EventHandler for Handler {
        async fn handle(&self, owner: &str, id: &str, payload: &serde_json::Value) -> Result<()> {
            assert_eq!(owner, "owner-a");
            assert_eq!(id, "delivery-a");
            assert_eq!(payload, &serde_json::json!({"data":"fixture"}));
            self.calls.fetch_add(1, Ordering::SeqCst);
            if let Some(wait) = &self.wait {
                wait.notified().await;
            }
            if self.fail {
                bail!("fixture failure");
            }
            Ok(())
        }
    }
    #[tokio::test]
    async fn success_requires_handler_completion_and_acknowledgment() {
        let mut inbox = FakeInbox::new();
        let handler = Handler {
            wait: None,
            fail: false,
            calls: AtomicUsize::new(0),
        };
        assert_eq!(
            consume_with(&inbox, "owner-a", &handler, Duration::from_secs(10))
                .await
                .unwrap(),
            Consumption::Acknowledged {
                delivery_id: "delivery-a".into()
            }
        );
        assert_eq!(inbox.acknowledgments.load(Ordering::SeqCst), 1);
        inbox.ack_ok = false;
        assert!(
            consume_with(&inbox, "owner-a", &handler, Duration::from_secs(10))
                .await
                .is_err()
        );
        inbox.empty = true;
        assert_eq!(
            consume_with(&inbox, "owner-a", &handler, Duration::from_secs(10))
                .await
                .unwrap(),
            Consumption::Empty
        );
        assert_eq!(handler.calls.load(Ordering::SeqCst), 2);
    }
    #[tokio::test]
    async fn long_handling_renews_and_failures_never_acknowledge() {
        for (renew_ok, handler_fails, renew_error) in [
            (true, false, false),
            (false, false, false),
            (true, true, false),
            (true, false, true),
        ] {
            let mut inbox = FakeInbox::new();
            inbox.renew_ok = renew_ok;
            inbox.renew_error = renew_error;
            let handler = Handler {
                wait: Some(inbox.renewed.clone()),
                fail: handler_fails,
                calls: AtomicUsize::new(0),
            };
            let result = consume_with(&inbox, "owner-a", &handler, Duration::from_millis(1)).await;
            assert_eq!(result.is_ok(), renew_ok && !handler_fails && !renew_error);
            assert!(inbox.renewals.load(Ordering::SeqCst) > 0);
            assert_eq!(
                inbox.acknowledgments.load(Ordering::SeqCst),
                usize::from(renew_ok && !handler_fails && !renew_error)
            );
        }
    }
}
