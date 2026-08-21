//! Built-in **generative UI** action (`ui.render`).
//!
//! Lets an agent render a rich, interactive UI inline in the chat instead of plain
//! markdown. The model passes a native json-render spec, or a bounded A2UI v0.9
//! message sequence, as `spec`; the desktop renders both through the app's own
//! `@ryu/ui` (shadcn) components, so agent-authored UI is visually consistent with
//! the rest of the product.
//!
//! This is a **client-rendered, no-op** tool: Core does not execute anything: the
//! actual rendering happens in the desktop from the tool *input*, which is already
//! surfaced to the UI by the sidecar's `ui_tool_input` event. The dispatch here only
//! does a light structural sanity-check and acknowledges, so the agent's tool loop
//! gets a clean result.
//!
//! Registered as a reserved registry server (`ui`) like `notify`/`threads`, so the
//! `<server>.<tool>` id scheme, per-agent allowlist, and single `call_tool` entry
//! all work for free.
//!
//! The model-facing contract (component vocabulary + spec shape) lives in the
//! generated `agent_ui_contract.md`, kept in sync with the renderer's catalog by
//! `scripts/gen-agent-ui-contract.ts` — never edit that file by hand.
//!
//! Set `placement` to `turn-end` when the UI is a completed result card that
//! belongs after the assistant's tool work. The default is `inline`, which
//! preserves the normal tool-row placement.

use anyhow::Result;
use serde_json::{json, Value};

use super::RegistryTool;

/// Reserved registry server name for the built-in generative-UI provider.
pub const SERVER_NAME: &str = "ui";

/// The model-facing description: how to compose a spec + the component catalog.
/// Generated from the renderer's catalog (see module docs).
const RENDER_CONTRACT: &str = include_str!("agent_ui_contract.md");

fn render_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "format": {
                "type": "string",
                "enum": ["json-render", "a2ui"],
                "default": "json-render",
                "description": "The UI format. Use json-render (default) for Ryu's native spec, or a2ui for an A2UI v0.9/v0.9.1 message sequence mapped into Ryu's native catalog."
            },
            "spec": {
                "oneOf": [
                    { "type": "object" },
                    { "type": "array", "items": { "type": "object" } },
                    { "type": "string", "description": "JSONL A2UI envelopes" }
                ],
                "description": "For json-render, a flat { root, elements, state? } object. For a2ui, one envelope object, a JSONL string, an array of JSON messages, or { messages: [...] } containing createSurface, updateComponents, updateDataModel, and deleteSurface envelopes."
            },
            "title": {
                "type": "string",
                "description": "Optional heading shown above the rendered UI."
            },
            "placement": {
                "type": "string",
                "enum": ["inline", "turn-end"],
                "description": "Render inline in the tool row (default) or once at the end of the completed assistant turn."
            }
        },
        "required": ["spec"]
    })
}

fn validate_a2ui_spec(spec: &Value) -> Result<()> {
    let jsonl_messages;
    let messages: Vec<&Value> = match spec {
        Value::String(stream) => {
            jsonl_messages = stream
                .lines()
                .enumerate()
                .filter_map(|(index, line)| {
                    let line = line.trim();
                    if line.is_empty() {
                        return None;
                    }
                    Some(serde_json::from_str::<Value>(line).map_err(|error| {
                        anyhow::anyhow!(
                            "A2UI JSONL line {} is not valid JSON: {}",
                            index + 1,
                            error
                        )
                    }))
                })
                .collect::<Result<Vec<_>>>()?;
            jsonl_messages.iter().collect()
        }
        Value::Array(messages) => messages.iter().collect(),
        Value::Object(object) => match object.get("messages") {
            Some(Value::Array(messages)) => messages.iter().collect(),
            Some(_) => {
                return Err(anyhow::anyhow!(
                    "A2UI 'messages' must be an array of envelope objects"
                ));
            }
            None => vec![spec],
        },
        _ => {
            return Err(anyhow::anyhow!(
                "A2UI 'spec' must be an envelope object or message array"
            ));
        }
    };

    if messages.is_empty() {
        return Err(anyhow::anyhow!(
            "A2UI 'spec' must contain at least one message"
        ));
    }
    if messages.len() > 128 {
        return Err(anyhow::anyhow!(
            "A2UI 'spec' may contain at most 128 messages"
        ));
    }

    for (index, message) in messages.into_iter().enumerate() {
        let object = message.as_object().ok_or_else(|| {
            anyhow::anyhow!("A2UI message {} must be an envelope object", index + 1)
        })?;
        if let Some(version) = object.get("version") {
            let supported = matches!(version.as_str(), Some("v0.9") | Some("v0.9.1"));
            if !supported {
                return Err(anyhow::anyhow!(
                    "unsupported A2UI version in message {}",
                    index + 1
                ));
            }
        }
        let operations = [
            "createSurface",
            "updateComponents",
            "updateDataModel",
            "deleteSurface",
        ];
        let present: Vec<&str> = operations
            .iter()
            .copied()
            .filter(|operation| object.contains_key(*operation))
            .collect();
        if present.len() != 1 {
            return Err(anyhow::anyhow!(
                "A2UI message {} must contain exactly one supported operation",
                index + 1
            ));
        }
        let operation = present[0];
        let payload = object
            .get(operation)
            .and_then(Value::as_object)
            .ok_or_else(|| anyhow::anyhow!("A2UI {operation} payload must be an object"))?;
        if !payload
            .get("surfaceId")
            .and_then(Value::as_str)
            .is_some_and(|surface_id| !surface_id.is_empty() && surface_id.len() <= 128)
        {
            return Err(anyhow::anyhow!(
                "A2UI {operation} requires a bounded surfaceId"
            ));
        }
        match operation {
            "createSurface" => {
                if !payload
                    .get("catalogId")
                    .and_then(Value::as_str)
                    .is_some_and(|catalog_id| !catalog_id.is_empty() && catalog_id.len() <= 512)
                {
                    return Err(anyhow::anyhow!(
                        "A2UI createSurface requires a bounded catalogId"
                    ));
                }
            }
            "updateComponents" => {
                let components = payload
                    .get("components")
                    .and_then(Value::as_array)
                    .ok_or_else(|| {
                        anyhow::anyhow!("A2UI updateComponents requires a components array")
                    })?;
                if components.len() > 100 {
                    return Err(anyhow::anyhow!(
                        "A2UI updateComponents may contain at most 100 components"
                    ));
                }
            }
            "updateDataModel" => {
                if let Some(path) = payload.get("path") {
                    if !path.as_str().is_some_and(|path| path.starts_with('/')) {
                        return Err(anyhow::anyhow!(
                            "A2UI updateDataModel path must be an absolute JSON Pointer"
                        ));
                    }
                }
            }
            "deleteSurface" => {}
            _ => unreachable!("operation is selected from the supported list"),
        }
    }
    Ok(())
}

/// The generative-UI tools exposed through the registry.
pub fn tools() -> Vec<RegistryTool> {
    vec![RegistryTool {
        id: format!("{SERVER_NAME}.render"),
        server: SERVER_NAME.to_owned(),
        name: "render".to_owned(),
        description: Some(RENDER_CONTRACT.to_owned()),
        input_schema: Some(render_schema()),
        ..Default::default()
    }]
}

/// Dispatch a `ui.render` call. No-op by design — the desktop renders from the tool
/// input. We validate the selected envelope enough for the model to get useful feedback
/// for an obviously malformed call; authoritative component mapping remains client-side.
pub async fn dispatch(tool: &str, arguments: Value) -> Result<Value> {
    match tool {
        "render" => {
            let spec = arguments
                .get("spec")
                .ok_or_else(|| anyhow::anyhow!("missing required object argument 'spec'"))?;
            let format = match arguments.get("format") {
                None => "json-render",
                Some(Value::String(format)) => format.as_str(),
                Some(_) => {
                    return Err(anyhow::anyhow!("'format' must be 'json-render' or 'a2ui'"));
                }
            };
            match format {
                "json-render" => {
                    let obj = spec.as_object().ok_or_else(|| {
                        anyhow::anyhow!("'spec' must be a json-render spec object")
                    })?;
                    if !obj.contains_key("root") || !obj.contains_key("elements") {
                        return Err(anyhow::anyhow!(
                            "'spec' must include 'root' (the root element key) and 'elements' (the element map)"
                        ));
                    }
                }
                "a2ui" => validate_a2ui_spec(spec)?,
                other => {
                    return Err(anyhow::anyhow!(
                        "unsupported ui.render format '{other}'; use 'json-render' or 'a2ui'"
                    ));
                }
            }
            Ok(json!({ "ok": true, "rendered": true }))
        }
        other => Err(anyhow::anyhow!("unknown ui tool '{other}'")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_render_tool_with_qualified_id() {
        let tools = tools();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].id, "ui.render");
        assert_eq!(tools[0].server, SERVER_NAME);
        assert!(tools[0].input_schema.is_some());
    }

    #[test]
    fn schema_allows_end_of_turn_cards() {
        let listed_tools = tools();
        let schema = listed_tools[0]
            .input_schema
            .as_ref()
            .expect("render schema");
        assert_eq!(
            schema["properties"]["placement"]["enum"],
            json!(["inline", "turn-end"])
        );
    }

    #[test]
    fn schema_lists_supported_formats() {
        let schema = tools()[0].input_schema.clone().expect("render schema");
        assert_eq!(
            schema["properties"]["format"]["enum"],
            json!(["json-render", "a2ui"])
        );
    }

    #[test]
    fn contract_lists_components() {
        // The generated contract must carry the component catalog, or the model has
        // no vocabulary. Guards against an empty/stale regeneration.
        assert!(RENDER_CONTRACT.contains("AVAILABLE COMPONENTS"));
        assert!(RENDER_CONTRACT.contains("Stack"));
    }

    #[tokio::test]
    async fn valid_spec_is_acknowledged() {
        let spec = json!({
            "spec": { "root": "a", "elements": { "a": { "type": "Text", "props": { "text": "hi" }, "children": [] } } }
        });
        let out = dispatch("render", spec).await.expect("dispatch ok");
        assert_eq!(out.get("ok").and_then(Value::as_bool), Some(true));
    }

    #[tokio::test]
    async fn valid_a2ui_message_array_is_acknowledged() {
        let out = dispatch(
            "render",
            json!({
                "format": "a2ui",
                "spec": [
                    {
                        "version": "v0.9",
                        "createSurface": {
                            "surfaceId": "status",
                            "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                        }
                    },
                    {
                        "version": "v0.9",
                        "updateComponents": {
                            "surfaceId": "status",
                            "components": [{"id": "root", "component": "Text", "text": "Ready"}]
                        }
                    }
                ]
            }),
        )
        .await
        .expect("dispatch ok");
        assert_eq!(out.get("ok").and_then(Value::as_bool), Some(true));
    }

    #[tokio::test]
    async fn valid_a2ui_jsonl_is_acknowledged() {
        let stream = [
            json!({
                "version": "v0.9",
                "createSurface": {
                    "surfaceId": "status",
                    "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                }
            }),
            json!({
                "version": "v0.9",
                "updateComponents": {
                    "surfaceId": "status",
                    "components": [{"id": "root", "component": "Text", "text": "Ready"}]
                }
            }),
        ]
        .into_iter()
        .map(|message| message.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        let out = dispatch("render", json!({ "format": "a2ui", "spec": stream }))
            .await
            .expect("dispatch ok");
        assert_eq!(out.get("ok").and_then(Value::as_bool), Some(true));
    }

    #[tokio::test]
    async fn malformed_a2ui_message_is_an_error() {
        assert!(dispatch(
            "render",
            json!({
                "format": "a2ui",
                "spec": [{"updateComponents": {"surfaceId": "status"}}]
            })
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn invalid_format_type_is_an_error() {
        assert!(dispatch("render", json!({ "format": 42, "spec": {} }))
            .await
            .is_err());
    }

    #[tokio::test]
    async fn missing_spec_is_an_error() {
        assert!(dispatch("render", json!({})).await.is_err());
    }

    #[tokio::test]
    async fn spec_without_root_is_an_error() {
        assert!(dispatch("render", json!({ "spec": { "elements": {} } }))
            .await
            .is_err());
    }

    #[tokio::test]
    async fn unknown_tool_is_an_error() {
        assert!(dispatch("nope", json!({ "spec": {} })).await.is_err());
    }
}
