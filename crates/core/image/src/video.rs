use crate::{ImageHost, MediaResponse};
use serde_json::{json, Value};
use std::time::Duration;

fn job_id(value: &Value) -> Result<Option<String>, &'static str> {
    if value.get("status").is_none() {
        return Ok(None);
    }
    let Some(id) = value.get("id").and_then(Value::as_str) else {
        return Ok(None);
    };
    if id.is_empty()
        || id.len() > 160
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("invalid local video job identifier");
    }
    Ok(Some(id.to_owned()))
}

fn completed(value: &mut Value) -> Result<Option<Value>, String> {
    match value.get("status").and_then(Value::as_str) {
        Some("failed" | "cancelled" | "canceled") => {
            let error = value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .or_else(|| value.get("error").and_then(Value::as_str))
                .unwrap_or("local video generation did not complete");
            Err(error.chars().take(1000).collect())
        }
        Some("completed" | "succeeded") => {
            let result = value
                .get_mut("result")
                .map(Value::take)
                .ok_or("local video job has no result")?;
            let mime = result
                .get("mime_type")
                .and_then(Value::as_str)
                .ok_or("local video result has no media type")?;
            if !["video/webm", "video/mp4", "video/webp", "video/x-msvideo"].contains(&mime) {
                return Err("unsupported local video container".into());
            }
            let data = result
                .get("b64_json")
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
                .ok_or("local video job returned no media")?;
            Ok(Some(
                json!({"data":[{"url":format!("data:{mime};base64,{data}"),"mediaType":mime}]}),
            ))
        }
        _ => Ok(None),
    }
}

/// Bridge native async jobs without exposing their engine-local identifiers.
pub async fn generate_local_video(host: &impl ImageHost, mut body: Value) -> MediaResponse {
    crate::take_request_id(&mut body);
    crate::take_project_id(&mut body);
    if let Some(object) = body.as_object_mut() {
        object.entry("video_frames").or_insert(json!(33));
        object.entry("fps").or_insert(json!(16));
        object.entry("output_format").or_insert(json!("webm"));
    }
    let base = host.sd_base_url();
    let client = crate::media_client();
    let mut active_job: Option<String> = None;
    let result = tokio::time::timeout(Duration::from_secs(600), async {
        if let Err(error) = host.start_local_engine().await {
            tracing::debug!(%error, "local video lazy start unavailable");
        }
        let (code, mut value) = crate::proxy(&base, "/sdcpp/v1/vid_gen", body).await;
        if code != 200 {
            return (code, value);
        }
        if let Ok(Some(media)) = completed(&mut value) {
            return (200, media);
        }
        let id = match job_id(&value) {
            Ok(Some(id)) => id,
            Ok(None) => {
                return (
                    502,
                    json!({"error": "local video engine returned no job identifier"}),
                );
            }
            Err(error) => return (502, json!({"error": error})),
        };
        active_job = Some(id.clone());
        loop {
            match completed(&mut value) {
                Ok(Some(media)) => return (200, media),
                Err(error) => return (502, json!({"error": error})),
                Ok(None) => {}
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
            let response = match client
                .get(format!("{base}/sdcpp/v1/jobs/{id}"))
                .send()
                .await
            {
                Ok(response) if response.status().is_success() => response,
                Ok(response) => {
                    return (
                        502,
                        json!({"error": format!("local video job unavailable ({})", response.status())}),
                    );
                }
                Err(error) => {
                    return (
                        502,
                        json!({"error": format!("local video job poll failed: {error}")}),
                    );
                }
            };
            value = match response.json::<Value>().await {
                Ok(value) => value,
                Err(_) => return (502, json!({"error": "invalid local video job response"})),
            };
            if value.get("id").and_then(Value::as_str) != Some(id.as_str()) {
                return (
                    502,
                    json!({"error": "local video job identity changed"}),
                );
            }
        }
    })
    .await;
    let response = match result {
        Ok(response) => response,
        Err(_) => (504, json!({"error":"local video generation timed out"})),
    };
    if response.0 >= 400 {
        if let Some(id) = active_job {
            let _ = client
                .post(format!("{base}/sdcpp/v1/jobs/{id}/cancel"))
                .timeout(Duration::from_secs(5))
                .send()
                .await;
        }
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_job_contract_preserves_container_type_and_rejects_path_ids() {
        assert!(job_id(&json!({"id":"../../other","status":"queued"})).is_err());
        assert_eq!(
            job_id(&json!({"id":"job_123","status":"queued"})).unwrap(),
            Some("job_123".into())
        );
        let result = completed(&mut json!({
            "status": "completed",
            "result": {"mime_type": "video/webm", "b64_json": "YWJj"}
        }))
        .unwrap()
        .unwrap();
        assert_eq!(result["data"][0]["url"], "data:video/webm;base64,YWJj");
        assert!(result.get("id").is_none());
        assert!(
            completed(&mut json!({"status":"cancelled","error":{"message":"Stopped"}})).is_err()
        );
        assert!(completed(
            &mut json!({"status":"completed","result":{"mime_type":"text/html","b64_json":"YWJj"}})
        )
        .is_err());
        assert!(completed(
            &mut json!({"status":"completed","result":{"mime_type":"video/webp","b64_json":"YWJj"}})
        )
        .is_ok());
    }
}
