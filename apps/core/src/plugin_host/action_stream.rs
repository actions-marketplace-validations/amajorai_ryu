use super::HookAction;
use serde_json::{Map, Value};
use std::collections::HashMap;

const MAX_STRING_CHARS: usize = 8_000;
const MAX_ARRAY_ITEMS: usize = 64;
const MAX_OBJECT_FIELDS: usize = 48;

#[derive(Debug)]
struct PendingTool {
    id: String,
    name: String,
    input: Option<Value>,
    sequence: u64,
}

#[derive(Debug)]
struct PendingThinking {
    id: String,
    input: Option<Value>,
    sequence: u64,
}

/// Reduces the common UI-message SSE stream to meaningful action boundaries.
///
/// The probe is deliberately ignorant of ACP and provider names. Thinking is
/// represented either by Ryu's synthetic Thinking tool part or by reasoning
/// deltas; every other tool-input/tool-output pair is a tool action.
#[derive(Debug, Default)]
pub struct ActionFrameProbe {
    buffer: String,
    next_sequence: u64,
    pending_tools: HashMap<String, PendingTool>,
    thinking: Option<PendingThinking>,
    reasoning: Option<PendingThinking>,
    failed: bool,
}

impl ActionFrameProbe {
    /// Feed arbitrary response bytes and return any completed action boundaries.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<HookAction> {
        self.buffer
            .push_str(String::from_utf8_lossy(bytes).as_ref());
        let mut actions = Vec::new();
        while let Some(newline) = self.buffer.find('\n') {
            let line = self.buffer[..newline].trim_end_matches('\r').to_owned();
            self.buffer.drain(..=newline);
            actions.extend(self.handle_line(&line));
        }
        actions
    }

    /// Finish the current stream and close any action that did not receive a
    /// terminal output frame.
    pub fn finish(&mut self) -> Vec<HookAction> {
        let mut actions = Vec::new();
        if !self.buffer.trim().is_empty() {
            let line = std::mem::take(&mut self.buffer);
            actions.extend(self.handle_line(line.trim_end_matches('\r')));
        }
        actions.extend(self.close_thinking());
        actions.extend(self.close_reasoning());

        let status = if self.failed { "failed" } else { "interrupted" };
        let mut pending: Vec<PendingTool> =
            self.pending_tools.drain().map(|(_, tool)| tool).collect();
        pending.sort_by_key(|tool| tool.sequence);
        actions.extend(pending.into_iter().map(|tool| HookAction {
            id: tool.id,
            kind: "tool".to_owned(),
            name: tool.name,
            input: tool.input,
            status: status.to_owned(),
            sequence: tool.sequence,
        }));
        actions
    }

    fn handle_line(&mut self, line: &str) -> Vec<HookAction> {
        let Some(data) = line.strip_prefix("data: ") else {
            return Vec::new();
        };
        if data == "[DONE]" {
            return self.finish();
        }
        let Ok(frame) = serde_json::from_str::<Value>(data) else {
            return Vec::new();
        };
        let Some(kind) = frame.get("type").and_then(Value::as_str) else {
            return Vec::new();
        };

        match kind {
            "reasoning-delta" => self.reasoning_delta(&frame),
            "tool-input-available" => self.tool_input(&frame),
            "tool-output-available" => self.tool_output(&frame),
            "text-start" | "text-delta" | "text-end" => {
                let mut actions = self.close_thinking();
                actions.extend(self.close_reasoning());
                actions
            }
            "finish" => self.finish(),
            "error" => {
                self.failed = true;
                self.finish()
            }
            _ => Vec::new(),
        }
    }

    fn reasoning_delta(&mut self, frame: &Value) -> Vec<HookAction> {
        let Some(delta) = frame.get("delta").and_then(Value::as_str) else {
            return Vec::new();
        };
        if delta.is_empty() {
            return Vec::new();
        }
        let actions = self.close_thinking();
        let (id, sequence, input) = match self.reasoning.as_mut() {
            Some(thought) => {
                let current = thought
                    .input
                    .take()
                    .and_then(|value| {
                        value
                            .get("thought")
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                    })
                    .unwrap_or_default();
                (
                    thought.id.clone(),
                    thought.sequence,
                    format!("{}{}", current, delta),
                )
            }
            None => {
                let sequence = self.allocate_sequence();
                (format!("reasoning-{sequence}"), sequence, delta.to_owned())
            }
        };
        self.reasoning = Some(PendingThinking {
            id,
            input: Some(Value::Object(Map::from_iter([(
                "thought".to_owned(),
                Value::String(truncate(input)),
            )]))),
            sequence,
        });
        actions
    }

    fn tool_input(&mut self, frame: &Value) -> Vec<HookAction> {
        let name = frame
            .get("toolName")
            .and_then(Value::as_str)
            .unwrap_or("tool")
            .to_owned();
        let input = frame.get("input").cloned().map(bound_value);
        if name.eq_ignore_ascii_case("thinking") {
            let actions = self.close_reasoning();
            let provider_id = frame
                .get("toolCallId")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .map(str::to_owned);
            if let Some(thought) = self.thinking.as_mut() {
                thought.input = input;
            } else {
                let sequence = self.allocate_sequence();
                self.thinking = Some(PendingThinking {
                    id: provider_id.unwrap_or_else(|| format!("thinking-{sequence}")),
                    input,
                    sequence,
                });
            }
            return actions;
        }

        let mut actions = self.close_thinking();
        actions.extend(self.close_reasoning());
        let id = frame
            .get("toolCallId")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map(str::to_owned);
        let Some(id) = id else {
            let sequence = self.allocate_sequence();
            actions.push(HookAction {
                id: format!("tool-{sequence}"),
                kind: "tool".to_owned(),
                name,
                input,
                status: "running".to_owned(),
                sequence,
            });
            return actions;
        };
        if let Some(tool) = self.pending_tools.get_mut(&id) {
            tool.input = input;
        } else {
            let sequence = self.allocate_sequence();
            self.pending_tools.insert(
                id.clone(),
                PendingTool {
                    id,
                    name,
                    input,
                    sequence,
                },
            );
        }
        actions
    }

    fn tool_output(&mut self, frame: &Value) -> Vec<HookAction> {
        let mut actions = self.close_thinking();
        actions.extend(self.close_reasoning());
        let Some(id) = frame.get("toolCallId").and_then(Value::as_str) else {
            return actions;
        };
        let Some(tool) = self.pending_tools.remove(id) else {
            return actions;
        };
        let status = frame
            .get("output")
            .and_then(|output| output.get("status"))
            .and_then(Value::as_str)
            .filter(|status| !status.is_empty())
            .unwrap_or("completed");
        actions.push(HookAction {
            id: tool.id,
            kind: "tool".to_owned(),
            name: tool.name,
            input: tool.input,
            status: status.to_owned(),
            sequence: tool.sequence,
        });
        actions
    }

    fn close_thinking(&mut self) -> Vec<HookAction> {
        self.thinking
            .take()
            .map(|thought| {
                vec![HookAction {
                    id: thought.id,
                    kind: "thinking".to_owned(),
                    name: "Thinking".to_owned(),
                    input: thought.input,
                    status: "completed".to_owned(),
                    sequence: thought.sequence,
                }]
            })
            .unwrap_or_default()
    }

    fn close_reasoning(&mut self) -> Vec<HookAction> {
        self.reasoning
            .take()
            .map(|thought| {
                vec![HookAction {
                    id: thought.id,
                    kind: "thinking".to_owned(),
                    name: "Thinking".to_owned(),
                    input: thought.input,
                    status: "completed".to_owned(),
                    sequence: thought.sequence,
                }]
            })
            .unwrap_or_default()
    }

    fn allocate_sequence(&mut self) -> u64 {
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        sequence
    }
}

fn truncate(value: String) -> String {
    value.chars().take(MAX_STRING_CHARS).collect()
}

fn bound_value(value: Value) -> Value {
    match value {
        Value::String(value) => Value::String(truncate(value)),
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .take(MAX_ARRAY_ITEMS)
                .map(bound_value)
                .collect(),
        ),
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .take(MAX_OBJECT_FIELDS)
                .map(|(key, value)| (truncate(key), bound_value(value)))
                .collect(),
        ),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emits_thinking_and_tool_actions_at_boundaries() {
        let mut probe = ActionFrameProbe::default();
        let frames = concat!(
            "data: {\"type\":\"tool-input-available\",\"toolCallId\":\"thought-1\",\"toolName\":\"Thinking\",\"input\":{\"thought\":\"I need to inspect the config\"}}\n\n",
            "data: {\"type\":\"tool-input-available\",\"toolCallId\":\"thought-1\",\"toolName\":\"Thinking\",\"input\":{\"thought\":\"I need to inspect the config before editing\"}}\n\n",
            "data: {\"type\":\"tool-input-available\",\"toolCallId\":\"call-1\",\"toolName\":\"Bash\",\"input\":{\"command\":\"npm test\"}}\n\n",
            "data: {\"type\":\"tool-output-available\",\"toolCallId\":\"call-1\",\"output\":{\"status\":\"completed\",\"output\":\"ignored\"}}\n\n",
            "data: {\"type\":\"finish\"}\n\n"
        );
        let actions = probe.feed(frames.as_bytes());
        assert_eq!(actions.len(), 2);
        assert_eq!(actions[0].kind, "thinking");
        assert_eq!(
            actions[0].input,
            Some(serde_json::json!({ "thought": "I need to inspect the config before editing" }))
        );
        assert_eq!(actions[1].name, "Bash");
        assert_eq!(actions[1].status, "completed");
        assert_eq!(
            actions[1].input,
            Some(serde_json::json!({ "command": "npm test" }))
        );
    }

    #[test]
    fn handles_split_sse_chunks_and_reasoning_deltas() {
        let mut probe = ActionFrameProbe::default();
        assert!(probe
            .feed(b"data: {\"type\":\"reasoning-delta\",\"delta\":\"first \"}\n")
            .is_empty());
        assert!(probe
            .feed(b"data: {\"type\":\"reasoning-delta\",\"delta\":\"second\"}\n\n")
            .is_empty());
        let actions = probe.feed(b"data: {\"type\":\"text-delta\",\"delta\":\"answer\"}\n\n");
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].kind, "thinking");
        assert_eq!(
            actions[0].input,
            Some(serde_json::json!({ "thought": "first second" }))
        );
    }

    #[test]
    fn interrupts_open_tools_without_leaking_tool_output() {
        let mut probe = ActionFrameProbe::default();
        assert!(probe
            .feed(
                b"data: {\"type\":\"tool-input-available\",\"toolCallId\":\"call-1\",\"toolName\":\"Bash\",\"input\":{\"command\":\"git status\",\"token\":\"secret\"}}\n\n"
            )
            .is_empty());
        let actions = probe.finish();
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].status, "interrupted");
        assert_eq!(
            actions[0].input,
            Some(serde_json::json!({ "command": "git status", "token": "secret" }))
        );
    }
}
