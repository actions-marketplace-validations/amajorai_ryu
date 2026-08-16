// Turn-hook body for Usage Pacer. This is a fragment, not an ES module.
// `ctx` holds the resolved agent + requested model; `host` is capability-gated.

const enabled = String(await host.getPreference({ key: "usage-pacer-enabled" }) ?? "false") === "true";
if (!enabled || !ctx.agent_id || !ctx.event || !ctx.event.model) return { kind: "none" };

const rawRules = await host.getPreference({ key: "usage-pacer-rules" });
let configuration;
try { configuration = JSON.parse(String(rawRules ?? "{}")); } catch (_error) { return { kind: "none" }; }
const rule = configuration?.agents?.[ctx.agent_id] ?? configuration?.global;
if (!rule || !Array.isArray(rule.ladder)) return { kind: "none" };

const snapshot = await host.usage({ agent_id: ctx.agent_id });
if (!snapshot?.available || !Array.isArray(snapshot.windows)) return { kind: "none" };

const now = Date.now();
const selectedWindows = snapshot.windows.filter((window) => {
  const seconds = Number(window.window_seconds ?? 0);
  if (rule.windows === "session") return seconds > 0 && seconds <= 6 * 60 * 60;
  if (rule.windows === "weekly") return seconds >= 6 * 24 * 60 * 60 && seconds <= 8 * 24 * 60 * 60;
  return seconds > 0;
});
if (selectedWindows.length === 0) return { kind: "none" };

function pace(window) {
  const used = Number(window.used_percent);
  const seconds = Number(window.window_seconds);
  const reset = Date.parse(String(window.resets_at ?? ""));
  if (!Number.isFinite(used) || !Number.isFinite(seconds) || !Number.isFinite(reset)) return { used, deficit: 0 };
  const expected = Math.max(0, Math.min(100, 100 * (1 - (reset - now) / (seconds * 1000))));
  return { used, deficit: used - expected };
}

const paces = selectedWindows.map(pace);
const used = Math.max(...paces.map((value) => value.used));
const deficit = Math.max(...paces.map((value) => value.deficit));
const mode = String(await host.getPreference({ key: "usage-pacer-mode" }) ?? "even");
const deficitLimit = Number(rule.pace_deficit ?? 15);
// Deficit raises the effective pressure only AFTER the configured tolerance. That
// means a 15-point deficit can trigger the next rung, but cannot jump every rung
// at once; spending still has to cross each ladder threshold.
const pressure = mode === "even" ? used + Math.max(0, deficit - deficitLimit) : used;
const ladder = rule.ladder
  .filter((step) => step && typeof step.model === "string" && Number.isFinite(Number(step.at)))
  .filter((step) => pressure >= Number(step.at));
let selected = String(ctx.event.model);
for (let hop = 0; hop < ladder.length; hop += 1) {
  const from = selected.toLowerCase();
  const next = ladder
    .filter((step) => !step.from || from.includes(String(step.from).toLowerCase()))
    .sort((left, right) => Number(right.at) - Number(left.at))[0];
  if (!next || String(next.model).trim() === "" || String(next.model) === selected) break;
  selected = String(next.model);
}
if (selected === ctx.event.model) return { kind: "none" };
return { kind: "select_model", model: selected, reason: `${Math.round(used)}% used; ${deficit >= 0 ? `${Math.round(deficit)}% in deficit` : `${Math.round(-deficit)}% in reserve`}` };
