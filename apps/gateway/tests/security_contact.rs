#[path = "../src/security_contact.rs"]
mod security_contact;

use axum::{
    body::Body,
    http::{Request, StatusCode},
    routing::get,
    Router,
};
use security_contact::PublicContactConfig;
use tower::ServiceExt;

#[tokio::test]
async fn rfc9116_endpoint_is_opt_in_and_contains_only_authored_metadata() {
    let config: PublicContactConfig = toml::from_str(&format!(
        r#"
enabled = true
name = "Example gateway"
contact = "https://example.com/security/contact"
canonical = "https://example.com/.well-known/security.txt"
expires = "{}"
"#,
        (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339()
    ))
    .unwrap();
    let app = Router::new().route(
        "/.well-known/security.txt",
        get(move || async move { security_contact::response(&config) }),
    );
    let response = app
        .oneshot(
            Request::builder()
                .uri("/.well-known/security.txt")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()["content-type"],
        "text/plain; charset=utf-8"
    );
    assert_eq!(response.headers()["cache-control"], "no-store");
    let bytes = axum::body::to_bytes(response.into_body(), 4096)
        .await
        .unwrap();
    let body = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(body.starts_with("# Example gateway\nContact: https://example.com/security/contact\n"));
    assert_eq!(body.lines().count(), 4);
    let disabled = Router::new().route(
        "/.well-known/security.txt",
        get(|| async { security_contact::response(&PublicContactConfig::default()) }),
    );
    let response = disabled
        .oneshot(
            Request::builder()
                .uri("/.well-known/security.txt")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
