//! Bounded framing and deadline helpers for sandbox subprocess protocols.
//!
//! A newline-delimited protocol is only bounded when both the frame and the
//! operations around it have explicit limits. These helpers are shared by the
//! Deno and secure-exec backends so one backend cannot reintroduce an unbounded
//! read, write, or child lifecycle wait.

use std::io::{self, ErrorKind};
use std::time::Instant;

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::Child;

/// Maximum payload size of one newline-delimited sandbox protocol frame.
///
/// The limit is a byte count and excludes the terminating newline. A frame
/// that never supplies a newline is rejected before retaining more than this
/// many bytes, so a child cannot make Core retain an ever-growing buffer.
pub(crate) const MAX_PROTOCOL_FRAME_BYTES: usize = 64 * 1024;

/// Maximum number of log entries retained for one execution.
///
/// The byte cap alone does not bound allocation: an attacker can emit an
/// unbounded number of empty log frames. Keeping the count bounded closes that
/// zero-byte accumulation path while preserving the existing byte ceiling.
pub(crate) const MAX_LOG_LINES: usize = 1024;

/// A newline-delimited reader that never retains more than one bounded frame.
pub(crate) struct BoundedFrameReader<R> {
    reader: BufReader<R>,
}

impl<R> BoundedFrameReader<R>
where
    R: AsyncRead,
{
    pub(crate) fn new(reader: R) -> Self {
        Self {
            reader: BufReader::new(reader),
        }
    }
}

impl<R> BoundedFrameReader<R>
where
    R: AsyncRead + Unpin,
{
    /// Read one frame without its newline or a trailing carriage return.
    ///
    /// A partial frame at EOF is rejected instead of being treated as a valid
    /// protocol message. That keeps every message on the wire explicitly
    /// framed and prevents an unterminated stream from bypassing the byte cap.
    pub(crate) async fn read_frame(&mut self) -> io::Result<Option<String>> {
        let mut frame = Vec::new();

        loop {
            let buffer = self.reader.fill_buf().await?;
            if buffer.is_empty() {
                if frame.is_empty() {
                    return Ok(None);
                }
                return Err(io::Error::new(
                    ErrorKind::UnexpectedEof,
                    "sandbox protocol frame ended before newline",
                ));
            }

            if let Some(newline) = buffer.iter().position(|byte| *byte == b'\n') {
                if frame.len().saturating_add(newline) > MAX_PROTOCOL_FRAME_BYTES {
                    return Err(frame_too_large());
                }
                frame.extend_from_slice(&buffer[..newline]);
                self.reader.consume(newline + 1);
                break;
            }

            if frame.len().saturating_add(buffer.len()) > MAX_PROTOCOL_FRAME_BYTES {
                return Err(frame_too_large());
            }
            let consumed = buffer.len();
            frame.extend_from_slice(buffer);
            self.reader.consume(consumed);
        }

        if frame.last() == Some(&b'\r') {
            frame.pop();
        }
        String::from_utf8(frame).map(Some).map_err(|error| {
            io::Error::new(
                ErrorKind::InvalidData,
                format!("sandbox protocol frame is not valid UTF-8: {error}"),
            )
        })
    }
}

/// Write and flush one protocol frame before the absolute deadline.
pub(crate) async fn write_line_until<W>(
    writer: &mut W,
    line: &str,
    deadline: Instant,
) -> io::Result<()>
where
    W: AsyncWrite + Unpin,
{
    if line.len() > MAX_PROTOCOL_FRAME_BYTES {
        return Err(frame_too_large());
    }

    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return Err(deadline_expired());
    }

    match tokio::time::timeout(remaining, async {
        writer.write_all(line.as_bytes()).await?;
        writer.write_all(b"\n").await?;
        writer.flush().await
    })
    .await
    {
        Ok(result) => result,
        Err(_) => Err(deadline_expired()),
    }
}

/// Kill a child and bound the reap wait by the same execution deadline.
pub(crate) async fn kill_and_reap(child: &mut Child, deadline: Instant) {
    // `start_kill` sends the signal without awaiting process exit. The reap is
    // deliberately separate and deadline-bounded so a terminal marker, a
    // malformed frame, or a timed-out operation cannot hang Core in `wait()`.
    let _ = child.start_kill();
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        let _ = child.try_wait();
        return;
    }
    let _ = tokio::time::timeout(remaining, child.wait()).await;
}

fn frame_too_large() -> io::Error {
    io::Error::new(
        ErrorKind::InvalidData,
        format!("sandbox protocol frame exceeded {MAX_PROTOCOL_FRAME_BYTES} bytes"),
    )
}

fn deadline_expired() -> io::Error {
    io::Error::new(
        ErrorKind::TimedOut,
        "sandbox protocol operation exceeded the wall-clock deadline",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{duplex, AsyncWriteExt};

    #[tokio::test]
    async fn bounded_reader_preserves_utf8_and_rejects_unterminated_frame() {
        let (mut writer, reader) = duplex(128);
        writer
            .write_all("@@RYU_DONE@@你好 🌍\n".as_bytes())
            .await
            .expect("write frame");
        drop(writer);

        let mut reader = BoundedFrameReader::new(reader);
        assert_eq!(
            reader.read_frame().await.expect("read frame"),
            Some("@@RYU_DONE@@你好 🌍".to_owned())
        );
        assert_eq!(reader.read_frame().await.expect("read EOF"), None);

        let (mut writer, reader) = duplex(128);
        writer
            .write_all(b"unterminated")
            .await
            .expect("write partial frame");
        drop(writer);
        let mut reader = BoundedFrameReader::new(reader);
        let error = reader
            .read_frame()
            .await
            .expect_err("partial frame must fail");
        assert_eq!(error.kind(), ErrorKind::UnexpectedEof);
    }

    #[tokio::test]
    async fn bounded_reader_rejects_a_repeating_no_newline_stream() {
        let (mut writer, reader) = duplex(MAX_PROTOCOL_FRAME_BYTES + 1);
        let write = tokio::spawn(async move {
            let chunk = vec![b'x'; 4096];
            loop {
                writer
                    .write_all(&chunk)
                    .await
                    .expect("reader should reject");
            }
        });
        let mut reader = BoundedFrameReader::new(reader);
        let error = reader
            .read_frame()
            .await
            .expect_err("oversized frame must fail");
        assert_eq!(error.kind(), ErrorKind::InvalidData);
        write.abort();
    }

    #[tokio::test]
    async fn bounded_reader_allows_limit_and_rejects_one_byte_over() {
        let (mut writer, reader) = duplex(MAX_PROTOCOL_FRAME_BYTES + 2);
        writer
            .write_all(&vec![b'x'; MAX_PROTOCOL_FRAME_BYTES])
            .await
            .expect("write exact-size frame");
        writer
            .write_all(b"\n")
            .await
            .expect("write frame delimiter");
        drop(writer);
        let mut reader = BoundedFrameReader::new(reader);
        let exact = reader
            .read_frame()
            .await
            .expect("exact-size frame must be accepted")
            .expect("expected exact-size frame");
        assert_eq!(exact.len(), MAX_PROTOCOL_FRAME_BYTES);

        let (mut writer, reader) = duplex(MAX_PROTOCOL_FRAME_BYTES + 2);
        writer
            .write_all(&vec![b'x'; MAX_PROTOCOL_FRAME_BYTES + 1])
            .await
            .expect("write oversized frame");
        writer
            .write_all(b"\n")
            .await
            .expect("write frame delimiter");
        drop(writer);
        let mut reader = BoundedFrameReader::new(reader);
        let error = reader
            .read_frame()
            .await
            .expect_err("one byte over the frame limit must fail");
        assert_eq!(error.kind(), ErrorKind::InvalidData);
    }

    #[tokio::test]
    async fn protocol_write_uses_the_absolute_deadline() {
        let (mut writer, _reader) = duplex(1);
        let error = write_line_until(
            &mut writer,
            &"x".repeat(MAX_PROTOCOL_FRAME_BYTES.min(4096)),
            Instant::now() + std::time::Duration::from_millis(20),
        )
        .await
        .expect_err("blocked write must time out");
        assert_eq!(error.kind(), ErrorKind::TimedOut);
    }
}
