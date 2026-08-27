//! Transport-neutral Machine Payments Protocol challenge normalization.
//!
//! Core never signs here. It validates the public challenge shape and returns a
//! stable, secret-free envelope that an approval/payment provider can continue.

use std::collections::BTreeMap;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const PAYMENT_REQUIRED_MARKER: &str = "__ryu_payment_required__";
pub const MCP_PAYMENT_REQUIRED_CODE: i64 = -32042;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentTransport {
    Http,
    Mcp,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct PaymentChallenge {
    pub id: String,
    pub realm: String,
    pub method: String,
    pub intent: String,
    pub request: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires: Option<String>,
    /// Exact public challenge representation needed by a payment provider.
    pub wire: Value,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct PaymentRequiredEnvelope {
    pub protocol: &'static str,
    pub transport: PaymentTransport,
    pub version: u8,
    pub challenge: PaymentChallenge,
    pub target: Value,
}

impl PaymentRequiredEnvelope {
    pub fn http(header: &str, target: Value) -> Option<Self> {
        let challenge = parse_http_challenge(header)?;
        Some(Self {
            protocol: "mpp",
            transport: PaymentTransport::Http,
            version: 1,
            challenge,
            target,
        })
    }

    pub fn from_http_headers<'a>(
        headers: impl IntoIterator<Item = &'a str>,
        target: Value,
    ) -> Option<Self> {
        headers
            .into_iter()
            .find_map(|header| Self::http(header, target.clone()))
    }

    pub fn mcp(error_data: &Value, target: Value) -> Option<Self> {
        Self::mcp_data(error_data, target, true)
    }

    pub fn mcp_metadata(metadata: &Value, target: Value) -> Option<Self> {
        Self::mcp_data(metadata, target, false)
    }

    fn mcp_data(data: &Value, target: Value, require_http_status: bool) -> Option<Self> {
        let data = data.as_object()?;
        if require_http_status && data.get("httpStatus").and_then(Value::as_u64) != Some(402) {
            return None;
        }
        let challenge_value = data.get("challenges")?.as_array()?.first()?.clone();
        let challenge = parse_challenge_object(&challenge_value, challenge_value.clone())?;
        Some(Self {
            protocol: "mpp",
            transport: PaymentTransport::Mcp,
            version: 1,
            challenge,
            target,
        })
    }

    pub fn into_value(self) -> Value {
        let mut value = serde_json::to_value(self).expect("payment envelope is serializable");
        if let Some(object) = value.as_object_mut() {
            object.insert(PAYMENT_REQUIRED_MARKER.to_owned(), Value::Bool(true));
        }
        value
    }
}

fn parse_challenge_object(value: &Value, wire: Value) -> Option<PaymentChallenge> {
    let object = value.as_object()?;
    let required_string = |name: &str| -> Option<String> {
        let value = object.get(name)?.as_str()?.trim();
        if value.is_empty() || value.len() > 16 * 1024 {
            return None;
        }
        Some(value.to_owned())
    };
    let request = object.get("request")?.clone();
    if !request.is_object() {
        return None;
    }
    Some(PaymentChallenge {
        id: required_string("id")?,
        realm: required_string("realm")?,
        method: required_string("method")?,
        intent: required_string("intent")?,
        request,
        description: optional_string(object.get("description"))?,
        digest: optional_string(object.get("digest"))?,
        expires: optional_string(object.get("expires"))?,
        wire,
    })
}

fn optional_string(value: Option<&Value>) -> Option<Option<String>> {
    match value {
        None | Some(Value::Null) => Some(None),
        Some(Value::String(value)) if value.len() <= 16 * 1024 => Some(Some(value.clone())),
        Some(_) => None,
    }
}

fn parse_http_challenge(header: &str) -> Option<PaymentChallenge> {
    if header.len() > 64 * 1024 || header.contains(['\r', '\n']) {
        return None;
    }
    let (scheme, params) = header.trim().split_once(char::is_whitespace)?;
    if !scheme.eq_ignore_ascii_case("Payment") {
        return None;
    }
    let params = parse_auth_params(params)?;
    let request_encoded = params.get("request")?;
    let request_bytes = URL_SAFE_NO_PAD.decode(request_encoded.as_bytes()).ok()?;
    if request_bytes.len() > 16 * 1024 {
        return None;
    }
    let request: Value = serde_json::from_slice(&request_bytes).ok()?;
    let object = json!({
        "id": params.get("id")?,
        "realm": params.get("realm")?,
        "method": params.get("method")?,
        "intent": params.get("intent")?,
        "request": request,
        "description": params.get("description"),
        "digest": params.get("digest"),
        "expires": params.get("expires"),
    });
    parse_challenge_object(&object, Value::String(header.to_owned()))
}

fn parse_auth_params(input: &str) -> Option<BTreeMap<String, String>> {
    let bytes = input.as_bytes();
    let mut index = 0;
    let mut params = BTreeMap::new();
    while index < bytes.len() {
        while index < bytes.len() && (bytes[index].is_ascii_whitespace() || bytes[index] == b',') {
            index += 1;
        }
        if index == bytes.len() {
            break;
        }
        let key_start = index;
        while index < bytes.len()
            && (bytes[index].is_ascii_alphanumeric() || matches!(bytes[index], b'-' | b'_'))
        {
            index += 1;
        }
        if index == key_start {
            return None;
        }
        let key = std::str::from_utf8(&bytes[key_start..index])
            .ok()?
            .to_ascii_lowercase();
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if bytes.get(index) != Some(&b'=') {
            return None;
        }
        index += 1;
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if bytes.get(index) != Some(&b'"') {
            return None;
        }
        index += 1;
        let mut value = String::new();
        let mut closed = false;
        while index < bytes.len() {
            match bytes[index] {
                b'"' => {
                    index += 1;
                    closed = true;
                    break;
                }
                b'\\' => {
                    index += 1;
                    let escaped = *bytes.get(index)?;
                    if !matches!(escaped, b'"' | b'\\') {
                        return None;
                    }
                    value.push(escaped as char);
                    index += 1;
                }
                byte if byte.is_ascii_control() => return None,
                byte => {
                    value.push(byte as char);
                    index += 1;
                }
            }
        }
        if !closed || value.len() > 32 * 1024 || params.insert(key, value).is_some() {
            return None;
        }
        if params.len() > 32 {
            return None;
        }
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if index < bytes.len() && bytes[index] != b',' {
            return None;
        }
    }
    Some(params)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;

    #[test]
    fn parses_native_http_challenge_into_secret_free_envelope() {
        let request = URL_SAFE_NO_PAD.encode(
            br#"{"amount":"10000","currency":"0x20c0000000000000000000000000000000000000","recipient":"0x0000000000000000000000000000000000000001","methodDetails":{"chainId":42431}}"#,
        );
        let header = format!(
            "Payment id=\"challenge-1\", realm=\"example.com\", method=\"tempo\", intent=\"charge\", request=\"{request}\""
        );
        let envelope = PaymentRequiredEnvelope::http(
            &header,
            json!({"kind":"http_tool","url":"https://example.com/paid"}),
        )
        .expect("valid MPP challenge");
        let value = envelope.into_value();
        assert_eq!(value[PAYMENT_REQUIRED_MARKER], true);
        assert_eq!(value["challenge"]["request"]["amount"], "10000");
        assert!(value.to_string().contains("challenge-1"));
        assert!(!value.to_string().contains("credential"));
    }

    #[test]
    fn rejects_non_mpp_and_malformed_402_headers() {
        assert!(PaymentRequiredEnvelope::http("Basic realm=\"x\"", json!({})).is_none());
        assert!(PaymentRequiredEnvelope::http(
            "Payment id=\"x\", realm=\"r\", method=\"tempo\", intent=\"charge\", request=\"not-base64\"",
            json!({})
        )
        .is_none());
    }

    #[test]
    fn parses_mcp_payment_required_error_data() {
        let envelope = PaymentRequiredEnvelope::mcp(
            &json!({
                "httpStatus": 402,
                "challenges": [{
                    "id": "mcp-1",
                    "realm": "example.com",
                    "method": "tempo",
                    "intent": "charge",
                    "request": {"amount":"1"}
                }]
            }),
            json!({"kind":"mcp_tool","server":"paid","tool":"lookup"}),
        )
        .expect("valid MCP payment error");
        assert_eq!(envelope.transport, PaymentTransport::Mcp);
        assert_eq!(envelope.challenge.id, "mcp-1");
    }

    #[test]
    fn parses_mcp_payment_required_result_metadata_without_http_status() {
        let envelope = PaymentRequiredEnvelope::mcp_metadata(
            &json!({
                "challenges": [{
                    "id": "mcp-meta-1",
                    "realm": "example.com",
                    "method": "tempo",
                    "intent": "charge",
                    "request": {"amount":"1"}
                }]
            }),
            json!({"kind":"mcp_tool","server":"paid","tool":"lookup"}),
        )
        .expect("valid MCP payment metadata");
        assert_eq!(envelope.challenge.id, "mcp-meta-1");
    }
}
