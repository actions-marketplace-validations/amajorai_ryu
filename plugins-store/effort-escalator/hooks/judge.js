// Turn-hook fragment for Effort Escalator. `ctx` and `host` are injected by Core.
const id = ctx.conversation_id;
if (!id) return { kind: "none" };
const enabled = String(await host.getPreference({ key: "effort-escalator-enabled" }) ?? "false") === "true";
if (!enabled) return { kind: "none" };
let rules;
try { rules = JSON.parse(String(await host.getPreference({ key: "effort-escalator-rules" }) ?? "{}")); } catch (_error) { return { kind: "none" }; }
const rule = rules?.agents?.[ctx.agent_id] ?? rules?.global;
if (!rule?.ladder?.length) return { kind: "none" };
const key = `effort-escalator:${id}`;
let state = {};
try { state = JSON.parse((await host.storage.get(key)) ?? "{}"); } catch (_error) {}
const now = Date.now();
const afterMs = Math.max(1, Number(rule.after_minutes ?? 30)) * 60 * 1000;
if (state.checked_at == null) {
  state = { ...state, checked_at: now };
  await host.storage.set(key, state);
  return { kind: "none" };
}
if (state.checked_at && now - Number(state.checked_at) < afterMs) return { kind: "none" };
const transcript = (Array.isArray(ctx.transcript) ? ctx.transcript : []).slice(-12)
  .map((m) => `${m.role}: ${String(m.content ?? "").slice(0, 1800)}`).join("\n");
if (!transcript) return { kind: "none" };
const verdict = await host.sideModel({
  model_pref_key: "effort-escalator-judge-model",
  system: "You are a cheap, read-only task-progress judge. Return exactly STUCK: yes or STUCK: no, followed by one short reason. Say yes only when the worker is looping, blocked, repeatedly failing, or clearly not making progress toward the user's request.",
  prompt: `<conversation-data>\n${transcript}\n</conversation-data>\nIs the worker stuck?`,
});
const stuck = /^\s*stuck:\s*yes\b/i.test(String(verdict ?? ""));
state = { checked_at: now, escalations: Number(state.escalations ?? 0), stuck };
if (!stuck || state.escalations >= Number(rule.max_escalations ?? rule.ladder.length)) {
  await host.storage.set(key, state);
  return { kind: "none" };
}
state.escalations += 1;
state.reason = String(verdict ?? "").slice(0, 500);
await host.storage.set(key, state);
return { kind: "note", text: `Effort Escalator detected stalled work; the next turn will use escalation ${state.escalations}. ${state.reason}` };
