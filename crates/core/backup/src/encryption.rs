//! RYU-BK01: independently authenticated 1 MiB frames with a random per-file
//! key salt, monotonic frame counter and authenticated total length. Missing,
//! reordered, appended and modified frames fail verification. No whole-file buffer.

use std::io::{Read, Write};

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use anyhow::{bail, ensure, Context, Result};
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};

const MAGIC: &[u8; 8] = b"RYU-BK01";
const FRAME: usize = 1024 * 1024;
const MAX_BYTES: u64 = 1024 * 1024 * 1024 * 1024;

pub fn new_key() -> String {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    base64::engine::general_purpose::STANDARD.encode(key)
}

pub fn parse_key(value: &str) -> Result<[u8; 32]> {
    base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .context("Recovery key must be a base64-encoded 32-byte key")
}

fn nonce(index: u64) -> [u8; 12] {
    let mut value = [0u8; 12];
    value[4..].copy_from_slice(&index.to_be_bytes());
    value
}

fn cipher(key: &[u8; 32], salt: &[u8]) -> Aes256Gcm {
    let mut file_key = [0u8; 32];
    hkdf::Hkdf::<Sha256>::new(Some(salt), key)
        .expand(b"ryu-backup-file-v1", &mut file_key)
        .expect("32-byte expansion");
    Aes256Gcm::new_from_slice(&file_key).expect("32-byte key")
}

pub fn encrypt(
    mut input: impl Read,
    mut output: impl Write,
    length: u64,
    key: &[u8; 32],
) -> Result<()> {
    ensure!(
        length <= MAX_BYTES,
        "Backup exceeds the 1 TiB archive limit"
    );
    let mut header = [0u8; 48];
    header[..8].copy_from_slice(MAGIC);
    header[8..16].copy_from_slice(&length.to_be_bytes());
    rand::thread_rng().fill_bytes(&mut header[16..]);
    let cipher = cipher(key, &header[16..]);
    output.write_all(&header)?;
    let mut remaining = length;
    let mut index = 0;
    loop {
        let count = remaining.min(FRAME as u64) as usize;
        let mut plain = vec![0; count];
        input
            .read_exact(&mut plain)
            .context("Snapshot changed during encryption")?;
        let nonce = nonce(index);
        let sealed = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &plain,
                    aad: &header,
                },
            )
            .map_err(|_| anyhow::anyhow!("Backup encryption failed"))?;
        output.write_all(&sealed)?;
        remaining -= count as u64;
        if remaining == 0 {
            break;
        }
        index += 1;
    }
    let mut extra = [0];
    ensure!(
        input.read(&mut extra)? == 0,
        "Snapshot grew during encryption"
    );
    output.flush()?;
    Ok(())
}

pub fn decrypt(mut input: impl Read, mut output: impl Write, key: &[u8; 32]) -> Result<()> {
    let mut header = [0; 48];
    input
        .read_exact(&mut header)
        .context("Incomplete backup header")?;
    ensure!(&header[..8] == MAGIC, "Unsupported backup format");
    let mut remaining = u64::from_be_bytes(header[8..16].try_into()?);
    ensure!(
        remaining <= MAX_BYTES,
        "Backup exceeds the 1 TiB archive limit"
    );
    let cipher = cipher(key, &header[16..]);
    let mut index = 0;
    loop {
        let count = remaining.min(FRAME as u64) as usize;
        let mut sealed = vec![0; count + 16];
        input
            .read_exact(&mut sealed)
            .context("Incomplete backup frame")?;
        let nonce = nonce(index);
        let plain = cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &sealed,
                    aad: &header,
                },
            )
            .map_err(|_| {
                anyhow::anyhow!(
                    "Backup authentication failed: incorrect recovery key or damaged backup"
                )
            })?;
        output.write_all(&plain)?;
        remaining -= count as u64;
        if remaining == 0 {
            break;
        }
        index += 1;
    }
    let mut extra = [0];
    if input.read(&mut extra)? != 0 {
        bail!("Backup contains unexpected trailing data");
    }
    output.flush()?;
    Ok(())
}

pub fn sha256(mut input: impl Read) -> Result<String> {
    let mut hash = Sha256::new();
    let mut buffer = vec![0; FRAME];
    loop {
        let count = input.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(hex::encode(hash.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multi_frame_round_trip_and_corruption_detection() {
        let key = parse_key(&new_key()).unwrap();
        let source = vec![42; FRAME * 2 + 123];
        let mut sealed = Vec::new();
        encrypt(source.as_slice(), &mut sealed, source.len() as u64, &key).unwrap();
        let mut restored = Vec::new();
        decrypt(sealed.as_slice(), &mut restored, &key).unwrap();
        assert_eq!(restored, source);
        for offset in [8, 20, FRAME + 36, sealed.len() - 1] {
            let mut damaged = sealed.clone();
            damaged[offset] ^= 1;
            assert!(decrypt(damaged.as_slice(), Vec::new(), &key).is_err());
        }
        assert!(decrypt(&sealed[..sealed.len() - 1], Vec::new(), &key).is_err());
        sealed.push(0);
        assert!(decrypt(sealed.as_slice(), Vec::new(), &key).is_err());
    }

    #[test]
    fn empty_files_are_authenticated_and_wrong_keys_fail() {
        let mut sealed = Vec::new();
        encrypt(&[][..], &mut sealed, 0, &[1; 32]).unwrap();
        decrypt(sealed.as_slice(), Vec::new(), &[1; 32]).unwrap();
        assert!(decrypt(sealed.as_slice(), Vec::new(), &[2; 32]).is_err());
        assert!(parse_key("not-a-key").is_err());
    }
}
