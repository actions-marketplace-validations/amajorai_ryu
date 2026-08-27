use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fmt::{Display, Formatter};

/// A canonicalization failure. Serialization is the only fallible operation;
/// JSON object ordering is normalized recursively after serialization.
#[derive(Debug)]
pub struct CanonicalError(serde_json::Error);

impl Display for CanonicalError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "could not canonicalize JSON: {}", self.0)
    }
}

impl std::error::Error for CanonicalError {}

impl From<serde_json::Error> for CanonicalError {
    fn from(value: serde_json::Error) -> Self {
        Self(value)
    }
}

/// Serialize a value as compact canonical JSON.
///
/// Object keys are sorted recursively by Unicode code point. Array order is
/// preserved. This is a deliberately small canonical form for serde JSON data;
/// it does not attempt to accept non-JSON floating point values.
pub fn canonical_json<T: Serialize>(value: &T) -> Result<Vec<u8>, CanonicalError> {
    let value = serde_json::to_value(value)?;
    let normalized = normalize(value);
    Ok(serde_json::to_vec(&normalized)?)
}

/// Return a lowercase SHA-256 digest of [`canonical_json`].
pub fn sha256_canonical<T: Serialize>(value: &T) -> Result<String, CanonicalError> {
    let bytes = canonical_json(value)?;
    let digest = Sha256::digest(bytes);
    Ok(to_lower_hex(&digest))
}

fn normalize(value: Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut entries: Vec<_> = object.into_iter().collect();
            entries.sort_by(|left, right| left.0.cmp(&right.0));
            let normalized = entries
                .into_iter()
                .map(|(key, value)| (key, normalize(value)))
                .collect();
            Value::Object(normalized)
        }
        Value::Array(values) => Value::Array(values.into_iter().map(normalize).collect()),
        scalar => scalar,
    }
}

fn to_lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    output
}
