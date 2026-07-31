// Turn-hook body for `chat-title.rename`, run in Core's plugin sandbox.
// Injected globals: `ctx` (the turn context) and `host` (the capability bridge:
// host.sideModel / host.storage / host.log / …).
//
// This file is a FRAGMENT, not an ES module: Core splices it into an async IIFE
// (apps/core/src/plugin_host/mod.rs `build_hook_program`) and it `return`s a hook
// directive. That is why a top-level `return` is correct here, and why
// plugins-store/*/hooks is excluded from Biome — a module parser rejects it.

const convId = ctx.conversation_id;
if (!convId) {
	return { kind: "none" };
}
const enabled = await host.getPreference({ key: "auto-title-enabled" });
if (enabled === "false") {
	return { kind: "none" };
}
let everyN = parseInt(
	(await host.getPreference({ key: "auto-title-every-n" })) || "5",
	10
);
if (!Number.isFinite(everyN) || everyN < 1) {
	everyN = 5;
}
if (everyN > 100) {
	everyN = 100;
}
const assistantTurns = (ctx.transcript || []).filter(
	(m) => m.role === "assistant"
).length;
if (assistantTurns < 1 || assistantTurns % everyN !== 0) {
	return { kind: "none" };
}
const recent = (ctx.transcript || [])
	.slice(-12)
	.map((m) => (m.role || "?") + ": " + String(m.content || "").slice(0, 500))
	.join("\n");
if (!recent.trim()) {
	return { kind: "none" };
}
const raw = await host.sideModel({
	system:
		"You write a short, specific title for a chat conversation based on the recent turns. Reply with ONLY the title: 3 to 6 words, in the same language as the chat, no surrounding quotes, no trailing punctuation, no markdown. Do not answer the chat — only title it.",
	prompt: recent,
	model_pref_key: "auto-title-model",
});
if (!raw || !String(raw).trim()) {
	return { kind: "none" };
}
try {
	await host.setConversationTitle({
		id: convId,
		title: String(raw).trim(),
		mode: "auto",
	});
} catch (e) {
	host.log("chat-title: setTitle failed", e);
}
return { kind: "none" };
