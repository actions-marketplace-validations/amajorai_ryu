//! Repository integration gate: requires Bun and installed Connect dependencies.
//! Exercises production Rust handoff -> production Connect HTTP router; only the
//! external Composio API is a fixture. No live provider account is used.
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

struct ConnectProcess(Child);
impl Drop for ConnectProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
        std::env::remove_var("RYU_CONNECT_URL");
        std::env::remove_var("RYU_CONNECT_USER_TOKENS");
        std::env::remove_var("RYU_CONNECT_USER_MANAGEMENT_TOKENS");
    }
}

#[tokio::test]
async fn rust_dispatch_reaches_native_connect_and_preserves_authorization() {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../apps/connect/src/core-handoff.fixture.ts");
    let mut process = ConnectProcess(Command::new("bun")
        .arg(fixture)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn().expect("Bun and installed Connect dependencies are required for this repository integration test"));
    let stdout = process.0.stdout.take().unwrap();
    let (send, receive) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut line = String::new();
        let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
        let _ = send.send(result);
    });
    let ready = receive
        .recv_timeout(Duration::from_secs(15))
        .expect("Connect fixture did not report readiness")
        .unwrap();
    reader.join().unwrap();
    let ready: Value = serde_json::from_str(&ready).unwrap();
    let base = ready["url"].as_str().unwrap();
    std::env::set_var("RYU_CONNECT_URL", base);
    std::env::set_var(
        "RYU_CONNECT_USER_TOKENS",
        r#"{"user-a":"runtime-a","user-b":"runtime-b"}"#,
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    assert_eq!(
        client
            .get(format!("{base}health"))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );

    let catalog = ryu_composio::service::catalog(Some("user-a"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        catalog["data"],
        json!([{"name":"GMAIL_GET_PROFILE","type":"composio"}])
    );
    let other = ryu_composio::service::catalog(Some("user-b"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(other["data"], json!([]));
    assert!(ryu_composio::service::catalog(Some("unmapped"))
        .await
        .unwrap()
        .is_err());
    assert!(ryu_composio::service::catalog(None).await.unwrap().is_err());

    let status = ryu_composio::service::connection_status("account-a", Some("user-a"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        status,
        json!({"id":"account-a", "status":"ACTIVE", "active":true, "toolkit":""})
    );
    for (id, user) in [
        ("account-a", "user-b"),
        ("other-account", "user-a"),
        ("account-a", "unmapped"),
    ] {
        assert!(ryu_composio::service::connection_status(id, Some(user))
            .await
            .unwrap()
            .is_err());
    }
    let accounts = ryu_composio::connect::list_connections(&client, "gmail", Some("user-a"))
        .await
        .unwrap();
    assert_eq!(
        accounts["data"],
        json!([{"id":"account-a", "toolkit":"gmail", "status":"ACTIVE", "active":true}])
    );
    let filtered = ryu_composio::service::list_connections("slack", Some("user-a"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(filtered["data"], json!([]));
    let other_accounts = ryu_composio::service::list_connections("", Some("user-b"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        other_accounts,
        json!({"object":"list", "configured":false, "data":[]})
    );
    assert!(
        ryu_composio::service::list_connections("", Some("unmapped"))
            .await
            .unwrap()
            .is_err()
    );

    let result = ryu_composio::service::dispatch(
        "GMAIL_GET_PROFILE",
        &json!({"query":"fixture"}),
        Some("user-a"),
        Some("account-a"),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        result,
        json!({"account":"account-a", "user":"provider-user-a", "version":"20251027_00", "arguments":{"query":"fixture"}})
    );
    assert!(!result.to_string().contains("private-provider-state"));
    for (user, tool, account) in [
        ("user-b", "GMAIL_GET_PROFILE", "account-a"),
        ("unmapped", "GMAIL_GET_PROFILE", "account-a"),
        ("user-a", "GMAIL_GET_PROFILE", "another-account"),
        ("user-a", "GMAIL_DELETE_EMAIL", "account-a"),
    ] {
        assert!(
            ryu_composio::service::dispatch(tool, &json!({}), Some(user), Some(account))
                .await
                .unwrap()
                .is_err()
        );
    }
    let proof: Value = client
        .get(format!("{base}proof"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        proof["providerCalls"], 4,
        "rejected calls must not reach the provider"
    );

    assert!(
        ryu_composio::connect::initiate(&client, "gmail", Some("user-c"))
            .await
            .is_err()
    );
    std::env::set_var(
        "RYU_CONNECT_USER_MANAGEMENT_TOKENS",
        r#"{"user-c":"runtime-c"}"#,
    );
    assert!(
        ryu_composio::connect::initiate(&client, "gmail", Some("user-c"))
            .await
            .is_err()
    );
    std::env::set_var(
        "RYU_CONNECT_USER_MANAGEMENT_TOKENS",
        r#"{"user-c":"manager-c"}"#,
    );
    assert!(
        ryu_composio::connect::initiate(&client, "slack", Some("user-c"))
            .await
            .is_err()
    );
    let initiated = ryu_composio::connect::initiate(&client, "gmail", Some("user-c"))
        .await
        .unwrap();
    assert_eq!(
        initiated,
        json!({"connection_id":"account-c", "redirect_url":"https://connect.composio.dev/fixture-login", "status":"INITIATED"})
    );
    assert!(
        ryu_composio::connect::initiate(&client, "gmail", Some("user-c"))
            .await
            .is_err()
    );

    assert!(
        ryu_composio::service::complete("fixture-session", Some("unmapped"))
            .await
            .unwrap()
            .is_err()
    );
    assert!(ryu_composio::service::complete("", Some("user-c"))
        .await
        .unwrap()
        .is_err());
    assert!(
        ryu_composio::service::complete("wrong-session", Some("user-c"))
            .await
            .unwrap()
            .is_err()
    );
    let completed = ryu_composio::service::complete("fixture-session", Some("user-c"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        completed,
        json!({"id":"account-c", "toolkit":"gmail", "status":"ACTIVE", "active":true})
    );
    assert!(
        ryu_composio::service::complete("fixture-session", Some("user-c"))
            .await
            .unwrap()
            .is_err()
    );

    std::env::set_var(
        "RYU_CONNECT_USER_TOKENS",
        r#"{"user-a":"runtime-a","user-b":"runtime-b","user-c":"runtime-c"}"#,
    );
    let executed = ryu_composio::service::dispatch(
        "GMAIL_GET_PROFILE",
        &json!({}),
        Some("user-c"),
        Some("account-c"),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        executed,
        json!({"account":"account-c","user":"provider-user-c","version":"latest","arguments":{}})
    );
    let revoked = client
        .post(format!("{base}v1/composio/revoke"))
        .bearer_auth("manager-c")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(revoked.status(), 200);
    assert_eq!(
        revoked.json::<Value>().await.unwrap(),
        json!({"status":"revoked", "active":false,"connectedAccountId":"account-c"})
    );
    let before: Value = client
        .get(format!("{base}proof"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(ryu_composio::service::dispatch(
        "GMAIL_GET_PROFILE",
        &json!({}),
        Some("user-c"),
        Some("account-c")
    )
    .await
    .unwrap()
    .is_err());
    let after: Value = client
        .get(format!("{base}proof"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        before, after,
        "revoked execution must not contact the provider"
    );

    process.0.kill().unwrap();
    process.0.wait().unwrap();
    assert!(
        ryu_composio::service::dispatch("GMAIL_GET_PROFILE", &json!({}), Some("user-a"), None)
            .await
            .unwrap()
            .is_err(),
        "stopped Connect must not select embedded execution"
    );
}
