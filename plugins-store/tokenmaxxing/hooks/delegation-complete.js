// Tokenmaxxing lifecycle hook. This flat fragment is hydrated by Core from
// code_file and runs with only ctx and the grant-gated host facade.

const event = ctx?.event;
if (!event || typeof event !== "object") return { kind: "none" };

const runId = typeof event.run_id === "string" ? event.run_id.trim() : "";
const agentId = typeof event.agent_id === "string" ? event.agent_id.trim() : "";
const activeCount = event.active_count;
const transitionId = event.transition_id;
if (
	!runId ||
	!agentId ||
	!Number.isInteger(activeCount) ||
	activeCount < 0 ||
	!Number.isSafeInteger(transitionId) ||
	transitionId < 1
) {
	return { kind: "none" };
}

// One registry key is intentional: active_count is Core-global across
// overlapping fan-outs, so dedupe must follow the global transition stream.
const key = "tokenmaxxing:global";
let previous = null;
try {
	const stored = await host.storage.get(key);
	if (typeof stored === "string" && stored.length > 0) previous = JSON.parse(stored);
} catch {
	return { kind: "none" };
}

if (previous && Number.isSafeInteger(previous.transition_id) && transitionId <= previous.transition_id) {
	return { kind: "none" };
}

try {
	await host.storage.set(key, JSON.stringify({ active_count: activeCount, transition_id: transitionId }));
} catch {
	return { kind: "none" };
}

if (previous?.active_count !== 1 || activeCount !== 0) return { kind: "none" };

try {
	await host.notify({
		title: "Delegated agents finished",
		body: `All delegated agents finished (${agentId}).`,
	});
} catch {
	// Notification is best effort; a missing active user/store must fail closed.
}
return { kind: "none" };
