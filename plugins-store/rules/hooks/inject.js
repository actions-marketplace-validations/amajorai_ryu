// Context-hook body for the Rules plugin.
// Injected globals: `ctx` (the outbound context) and `host` (the capability
// bridge). This is a fragment, not an ES module; a top-level return is required.

const RULES_OPEN = "<ryu-rules-context>";
const RULES_CLOSE = "</ryu-rules-context>";
const RULES_BLOCK = new RegExp(
	`\\n*${RULES_OPEN.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\n[\\s\\S]*?${RULES_CLOSE}`,
	"g",
);

function asObject(value, fallback = {}) {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value;
	}
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed;
			}
		} catch {
			// Preferences are user-controlled and may contain a legacy scalar.
		}
	}
	return fallback;
}

function asBoolean(value, fallback) {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		if (value.toLowerCase() === "true") return true;
		if (value.toLowerCase() === "false") return false;
	}
	return fallback;
}

function asMode(value, fallback = "auto") {
	const mode = String(value || "").toLowerCase();
	return ["auto", "always", "path", "intelligent", "manual"].includes(mode)
		? mode
		: fallback;
}

function textOfContent(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return content == null ? "" : String(content);
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			return part && part.type === "text" && typeof part.text === "string" ? part.text : "";
		})
		.join("\n");
}

function cleanText(text) {
	return String(text || "").replace(RULES_BLOCK, "");
}

const projectInstructions =
	typeof ctx?.project_instructions === "string" ? ctx.project_instructions : "";

function stripProjectInstructions(text) {
	if (!projectInstructions.trim()) return String(text || "");
	return String(text || "")
		.split(projectInstructions)
		.join("")
		.replace(/\n{3,}/g, "\n\n");
}

function cleanupOnly() {
	if (Array.isArray(ctx?.messages)) {
		let changed = false;
		const messages = ctx.messages.map((message) => {
			if (message?.role === "system" && typeof message.content === "string") {
				const content = stripProjectInstructions(cleanText(message.content));
				if (content !== message.content) changed = true;
				return { ...message, content };
			}
			if (message?.role === "user" && typeof message.content === "string") {
				const content = cleanText(message.content);
				if (content !== message.content) changed = true;
				return { ...message, content };
			}
			return message;
		});
		return changed ? { kind: "rewrite", messages } : { kind: "none" };
	}
	if (typeof ctx?.input === "string") {
		const text = stripProjectInstructions(cleanText(ctx.input));
		return text === ctx.input ? { kind: "none" } : { kind: "replace", text, fresh_session: true };
	}
	return { kind: "none" };
}

function escapeRegex(text) {
	const regexCharacters = new Set(["\\", "^", "$", ".", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|"]);
	return [...String(text)]
		.map((character) => (regexCharacters.has(character) ? `\\${character}` : character))
		.join("");
}

function matchesSimpleGlob(value, glob) {
	if (!glob) return false;
	let pattern = "";
	const source = String(glob);
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		if (character === "*" && source[index + 1] === "*") {
			if (source[index + 2] === "/") {
				pattern += "(?:.*/)?";
				index += 2;
			} else {
				pattern += ".*";
				index += 1;
			}
		} else if (character === "*") {
			pattern += "[^/]*";
		} else if (character === "?") {
			pattern += ".";
		} else {
			pattern += escapeRegex(character);
		}
	}
	try {
		return new RegExp(`(^|/)${pattern}$|${pattern}`).test(String(value || ""));
	} catch {
		return false;
	}
}

function matchesGlob(value, glob) {
	const source = String(glob || "");
	const brace = source.match(/\{([^{}]+)\}/);
	if (!brace) return matchesSimpleGlob(value, source);
	return brace[1]
		.split(",")
		.some((choice) => matchesGlob(value, source.replace(brace[0], choice.trim())));
}

function globList(rule) {
	if (Array.isArray(rule?.globs)) return rule.globs;
	if (typeof rule?.globs === "string") return [rule.globs];
	return [];
}

function words(text) {
	return new Set(
		String(text || "")
			.toLowerCase()
			.split(/[^a-z0-9_./-]+/)
			.filter((word) => word.length >= 3),
	);
}

function matchesRule(rule, mode, latestText) {
	if (mode === "always") return true;
	if (mode === "manual") return false;
	const source = String(latestText || "");
	const path = String(rule?.path || "");
	const globs = globList(rule);
	if (mode === "path") {
		return Boolean(
			(path && source.toLowerCase().includes(path.toLowerCase())) ||
			globs.some((glob) => matchesGlob(source, glob)),
		);
	}
	if (mode === "intelligent") {
		const haystack = words(source);
		const hints = [path, rule?.description, ...globs]
			.flatMap((hint) => [...words(hint)])
			.filter((word, index, all) => all.indexOf(word) === index);
		return hints.some((hint) => haystack.has(hint)) || matchesRule(rule, "path", source);
	}
	// `auto` is the default: it is an always-on rule mode for agent-base rules,
	// while project rules use the plugin's configured mode below.
	return true;
}

function latestUserText(messages, input) {
	if (Array.isArray(messages)) {
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			if (messages[index]?.role === "user") {
				return textOfContent(messages[index].content);
			}
		}
	}
	return typeof input === "string" ? input : "";
}

function appendRuleBlock(text, ruleText) {
	return `${cleanText(text)}\n\n${RULES_OPEN}\n${ruleText}\n${RULES_CLOSE}`;
}

let agentId = String(ctx?.agent_id || "default");
let preferences = {};
try {
	preferences = asObject(
		await host.getPreference({ key: `rules.agent.${encodeURIComponent(agentId)}` }),
	);
} catch {
	// A missing preference is the normal first-run state.
}

const enabled = asBoolean(preferences.enabled, true);
const autoInject = asBoolean(preferences.autoInject, true);
if (!enabled) {
	return cleanupOnly();
}
if (!autoInject) return cleanupOnly();

const configuredMode = asMode(preferences.applyMode, "auto");
const turnsPerPlan = Math.max(0, Number.parseInt(String(preferences.turnsPerPlan ?? 0), 10) || 0);
const latestText = latestUserText(ctx?.messages, ctx?.input);
const agentRules = Array.isArray(preferences.rules) ? preferences.rules : [];
const baseRules = agentRules
	.filter((rule) => asBoolean(rule?.enabled, true) && String(rule?.text || "").trim())
	.filter((rule) => asMode(rule?.mode ?? rule?.applyMode, "auto") !== "manual")
	.map((rule) => ({
		id: String(rule.id || `agent-${agentRules.indexOf(rule) + 1}`),
		text: String(rule.text).trim(),
		label: "agent",
	}));

const projectRules = Array.isArray(ctx?.project_rules) ? ctx.project_rules : [];
const selectedProjectRules = projectRules
	.filter((rule) => asBoolean(rule?.enabled, true) && String(rule?.content || "").trim())
	.filter((rule) => {
		const mode = asMode(rule?.apply_mode, configuredMode);
		return matchesRule(rule, configuredMode === "auto" ? mode : configuredMode, latestText);
	})
	.map((rule) => ({
		id: String(rule.id || rule.path || "project-rule"),
		text: String(rule.content).trim(),
		label: String(rule.path || rule.provider || "project"),
	}));

const selected = [...baseRules, ...selectedProjectRules];
if (selected.length === 0) {
	return cleanupOnly();
}

let countKey = null;
let count = 0;
if (turnsPerPlan > 0 && ctx?.conversation_id) {
	countKey = `turns:${ctx.conversation_id}`;
	try {
		count = Number.parseInt(String(await host.storage.get(countKey)), 10) || 0;
	} catch {
		count = 0;
	}
	if (count >= turnsPerPlan) {
		return cleanupOnly();
	}
}

const ruleText = selected
	.map((rule) => `### ${rule.label} (${rule.id})\n${rule.text}`)
	.join("\n\n");
if (countKey) {
	try {
		await host.storage.set(countKey, String(count + 1));
	} catch {
		// Injection remains useful even when the optional counter cannot persist.
	}
}

if (Array.isArray(ctx?.messages)) {
	let changed = false;
	const messages = ctx.messages.map((message) => {
		if (message?.role === "system" && typeof message.content === "string") {
			const content = stripProjectInstructions(cleanText(message.content));
			if (content !== message.content) changed = true;
			return { ...message, content };
		}
		if (message?.role !== "user") return message;
		if (typeof message.content === "string") {
			const cleaned = cleanText(message.content);
			if (cleaned !== message.content) changed = true;
			return { ...message, content: cleaned };
		}
		if (Array.isArray(message.content)) {
			const content = message.content.map((part) => {
				if (part?.type !== "text" || typeof part.text !== "string") return part;
				const cleaned = cleanText(part.text);
				if (cleaned !== part.text) changed = true;
				return { ...part, text: cleaned };
			});
			return { ...message, content };
		}
		return message;
	});
	let lastUserIndex = -1;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]?.role === "user") {
			lastUserIndex = index;
			break;
		}
	}
	if (lastUserIndex < 0) return changed ? { kind: "rewrite", messages } : { kind: "none" };
	const message = messages[lastUserIndex];
	if (typeof message.content === "string") {
		messages[lastUserIndex] = { ...message, content: appendRuleBlock(message.content, ruleText) };
	} else if (Array.isArray(message.content)) {
		messages[lastUserIndex] = {
			...message,
			content: [...message.content, { type: "text", text: appendRuleBlock("", ruleText).trimStart() }],
		};
	} else {
		messages[lastUserIndex] = { ...message, content: appendRuleBlock("", ruleText).trimStart() };
	}
	return { kind: "rewrite", messages };
}

if (typeof ctx?.input !== "string" || !ctx.input.trim()) {
	return { kind: "none" };
}
const prompt = appendRuleBlock(stripProjectInstructions(cleanText(ctx.input)), ruleText);
return { kind: "replace", text: prompt, fresh_session: true };
