//! Small, platform-native formatting helpers shared by both WhatsApp adapters.
//!
//! WhatsApp does not understand CommonMark. Keeping this conversion here means
//! Cloud API and OpenWA replies have the same rendering and the same 4096
//! character guard instead of each adapter slowly growing its own dialect.

/// Convert the markdown forms Ryu commonly emits into WhatsApp's inline syntax.
pub fn render_markdown(input: &str) -> String {
    input
        .lines()
        .map(|line| {
            let trimmed = line.trim_start();
            if let Some(heading) = trimmed.strip_prefix("# ") {
                let indent = &line[..line.len() - trimmed.len()];
                return format!("{indent}*{}*", convert_inline(heading));
            }
            convert_inline(line)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn convert_inline(input: &str) -> String {
    let linked = convert_links(input);
    linked
        .replace("**", "*")
        .replace("__", "_")
        .replace("~~", "~")
}

/// Turn `[label](https://example.com)` into `label (https://example.com)`.
/// WhatsApp will still make the URL tappable, while the markdown punctuation
/// does not leak into the conversation.
fn convert_links(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut cursor = 0;
    while cursor < input.len() {
        let Some(open_offset) = input[cursor..].find('[') else {
            output.push_str(&input[cursor..]);
            break;
        };
        let open = cursor + open_offset;
        output.push_str(&input[cursor..open]);
        let Some(label_end_offset) = input[open + 1..].find("](") else {
            output.push_str(&input[open..]);
            break;
        };
        let label_end = open + 1 + label_end_offset;
        let url_start = label_end + 2;
        let Some(url_end_offset) = input[url_start..].find(')') else {
            output.push_str(&input[open..]);
            break;
        };
        let url_end = url_start + url_end_offset;
        let label = &input[open + 1..label_end];
        let url = &input[url_start..url_end];
        if label.is_empty() || url.is_empty() {
            output.push_str(&input[open..=url_end]);
        } else {
            output.push_str(label);
            output.push_str(" (");
            output.push_str(url);
            output.push(')');
        }
        cursor = url_end + 1;
    }
    output
}

/// Split a WhatsApp body without exceeding the platform's 4096-character cap.
/// Prefer a newline so a long answer remains readable, but never split a UTF-8
/// code point.
pub fn split_text(input: &str) -> Vec<String> {
    const MAX_CHARS: usize = 4096;
    let mut remaining: Vec<char> = input.chars().collect();
    if remaining.is_empty() {
        return vec![String::new()];
    }

    let mut parts = Vec::new();
    while remaining.len() > MAX_CHARS {
        let mut cut = MAX_CHARS;
        for index in (1..=MAX_CHARS).rev() {
            if remaining[index - 1] == '\n' {
                cut = index;
                break;
            }
        }
        parts.push(remaining[..cut].iter().collect::<String>());
        remaining.drain(..cut);
        while remaining.first() == Some(&'\n') {
            remaining.remove(0);
        }
    }
    parts.push(remaining.iter().collect());
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_common_markdown_as_whatsapp_syntax() {
        assert_eq!(
            render_markdown("# Heading\n**bold** ~~gone~~ [docs](https://ryu.dev)"),
            "*Heading*\n*bold* ~gone~ docs (https://ryu.dev)"
        );
    }

    #[test]
    fn splits_at_newlines_and_never_splits_unicode() {
        let input = format!("{}\n{}", "a".repeat(4090), "🦀".repeat(20));
        let parts = split_text(&input);
        assert!(parts.iter().all(|part| part.chars().count() <= 4096));
        assert_eq!(parts.concat(), input);
    }
}
