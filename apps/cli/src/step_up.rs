use std::io::{self, Write};
use std::time::Duration;

use anyhow::{Context, Result};
use serde::Deserialize;

/// Step-up ("confirm it's you") verification for the CLI.
///
/// The control plane refuses a handful of irreversible actions — deleting a
/// workspace, revoking an org-wide key, destroying a node, any staff action —
/// unless the session re-proved a second factor in the last few minutes. That
/// gate is server-side, so it already applies to `ryu` exactly as it does to the
/// website, the desktop app and the phone. What lives here is the other half:
/// noticing the refusal and letting someone answer it without leaving the
/// terminal.
///
/// The wire protocol is the same three endpoints the TypeScript clients use
/// (`packages/step-up`): `GET /api/step-up/status`, `POST /api/step-up/challenge`,
/// `POST /api/step-up/verify`.

/// The marker a gated endpoint returns in its 403 body.
pub const STEP_UP_REQUIRED: &str = "STEP_UP_REQUIRED";

static HTTP: std::sync::LazyLock<reqwest::Client> =
    std::sync::LazyLock::new(reqwest::Client::new);

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepUpStatus {
    /// Plain-language description of what the code authorizes.
    pub action: String,
    /// True when the scope needs enrolled 2FA and this account has none.
    #[serde(default)]
    pub enrolment_required: bool,
    /// Factors on offer, best first: "totp", "otp", "backup".
    #[serde(default)]
    pub methods: Vec<String>,
    /// True when a live window already covers the scope.
    #[serde(default)]
    pub satisfied: bool,
}

/// True when a failed response body is the gate asking for a code rather than a
/// flat refusal. Both shapes appear: the control plane answers `{"error":
/// "STEP_UP_REQUIRED", …}` and Better Auth's own endpoints answer `{"code":
/// "STEP_UP_REQUIRED", …}`.
pub fn is_step_up_required(body: &serde_json::Value) -> bool {
    let matches = |key: &str| body.get(key).and_then(|v| v.as_str()) == Some(STEP_UP_REQUIRED);
    matches("error") || matches("code")
}

/// The scope named in a gate's refusal, when it carried one.
pub fn scope_from_body(body: &serde_json::Value) -> Option<String> {
    body.get("scope")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

async fn status(backend_url: &str, token: &str, scope: &str) -> Result<StepUpStatus> {
    let resp = HTTP
        .get(format!("{backend_url}/api/step-up/status?scope={scope}"))
        .header("Authorization", format!("Bearer {token}"))
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .context("could not reach the step-up service")?;
    if !resp.status().is_success() {
        anyhow::bail!("step-up status failed (HTTP {})", resp.status());
    }
    resp.json().await.context("unreadable step-up status")
}

async fn challenge(backend_url: &str, token: &str, scope: &str) -> Result<()> {
    let resp = HTTP
        .post(format!("{backend_url}/api/step-up/challenge"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({ "scope": scope }))
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .context("could not request a code")?;
    if !resp.status().is_success() {
        anyhow::bail!("could not send a code (HTTP {})", resp.status());
    }
    Ok(())
}

async fn verify(backend_url: &str, token: &str, scope: &str, method: &str, code: &str) -> Result<()> {
    let resp = HTTP
        .post(format!("{backend_url}/api/step-up/verify"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({ "scope": scope, "method": method, "code": code }))
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .context("could not verify the code")?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body: serde_json::Value = resp.json().await.unwrap_or_default();
        let message = body
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("that code didn't work");
        anyhow::bail!("{message} (HTTP {status})");
    }
    Ok(())
}

/// Read one line from the terminal. Not masked: a one-time code is worthless
/// seconds later, and hiding it only makes a fat-fingered entry harder to spot.
///
/// Plain stdout/stdin, so this belongs to command-mode `ryu`, NOT the TUI. If a
/// gated call is ever made from inside the interactive UI (raw mode, alternate
/// screen), print the prompt through the UI layer instead — writing here would
/// scribble over the rendered frame.
fn read_code(prompt: &str) -> Result<String> {
    print!("{prompt}");
    io::stdout().flush().ok();
    let mut line = String::new();
    io::stdin()
        .read_line(&mut line)
        .context("could not read the code")?;
    Ok(line.trim().to_string())
}

/// How many wrong codes to accept before giving up. The server stops at five;
/// stopping first keeps the CLI from burning someone's whole budget in a loop.
const MAX_TRIES: usize = 3;

/// Prove a second factor for `scope`, prompting on the terminal.
///
/// Returns immediately when a live window already covers the scope, so a run of
/// commands costs one code rather than one per command. Refuses (rather than
/// prompting for something unanswerable) when the scope demands enrolled 2FA the
/// account does not have.
pub async fn ensure(backend_url: &str, token: &str, scope: &str) -> Result<()> {
    let state = status(backend_url, token, scope).await?;
    if state.satisfied {
        return Ok(());
    }
    if state.enrolment_required {
        anyhow::bail!(
            "Staff actions need two-factor authentication on your account. \
             Turn it on in Settings, then try again."
        );
    }

    let method = state.methods.first().cloned().unwrap_or_else(|| "otp".into());
    let where_the_code_is = match method.as_str() {
        "totp" => "from your authenticator app",
        "backup" => "one of your backup codes",
        _ => "we emailed you",
    };
    if method == "otp" {
        challenge(backend_url, token, scope).await?;
    }

    println!("Confirm it's you to {}. This can't be undone.", state.action);
    for attempt in 1..=MAX_TRIES {
        let code = read_code(&format!("Enter the code {where_the_code_is}: "))?;
        if code.is_empty() {
            anyhow::bail!("cancelled");
        }
        match verify(backend_url, token, scope, &method, &code).await {
            Ok(()) => return Ok(()),
            Err(err) if attempt < MAX_TRIES => println!("{err}"),
            Err(err) => return Err(err),
        }
    }
    unreachable!("the loop returns on its last attempt")
}
