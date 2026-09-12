// Run against the isolated Core described in docs/proof/health-audit/verification.md.

import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("on-demand audits run the default ACP agent, retain transcripts, and release process slots", async () => {
	const fixturePath = fileURLToPath(
		new URL("./health-audit-acp-fixture.mjs", import.meta.url)
	);
	const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
	const db = new Database("/tmp/ryu-health-audit-live/agents.db", {
		readwrite: true,
	});
	const source = db.query("SELECT * FROM agents WHERE id = ?").get("ryu");
	assert.ok(source, "Start the isolated Core first to seed its builtin agent");
	const engine = `acp-exec: ${quote(process.execPath)} ${quote(fixturePath)}`;
	const record = {
		...source,
		id: "audit-acp-proof",
		name: "Health audit ACP proof",
		engine,
		model: null,
		chat_model: JSON.stringify({ engine }),
		system_prompt: "Review the supplied health evidence.",
		safety_profile: "read_only",
		lifecycle_status: "trial",
		built_in: 0,
		tools: "[]",
		skills: "[]",
	};
	const columns = Object.keys(record);
	db.query(
		`INSERT OR REPLACE INTO agents (${columns.map((name) => `"${name}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`
	).run(...Object.values(record));
	db.close();
	const base = "http://127.0.0.1:17986";
	const headers = {
		authorization: "Bearer audit-proof",
		"content-type": "application/json",
	};
	const agent = { id: "audit-acp-proof" };
	for (const [key, value] of [
		["default-cloud-agent-selection", JSON.stringify({ agent_id: agent.id })],
		["security-scanner-agent", ""],
	]) {
		const saved = await fetch(`${base}/api/preferences/${key}`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ value }),
		});
		assert.equal(saved.status, 200);
	}
	for (const kind of ["app", "plugin", "skill", "agent", "gateway"]) {
		const input = {
			execution: "agent",
			kind,
			id: "proof",
			name: `${kind} proof`,
			scorecard: { score: 88 },
			metadata: { snapshot: true },
		};
		const denied = await fetch(`${base}/api/catalog/scan`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
		});
		assert.equal(denied.status, 401);
		const response = await fetch(`${base}/api/catalog/scan`, {
			method: "POST",
			headers,
			body: JSON.stringify(input),
		});
		const result = await response.json();
		assert.equal(response.status, 200, JSON.stringify(result));
		assert.equal(result.status, "complete", JSON.stringify(result));
		assert.equal(result.assessment.score, 78);
		assert.equal(result.agent_id, agent.id);
		assert.equal(result.execution, "agent");
		assert.match(result.conversationId, /^[a-f0-9-]{36}$/);
		const transcriptResponse = await fetch(
			`${base}/api/conversations/${result.conversationId}`,
			{ headers }
		);
		assert.equal(transcriptResponse.status, 200);
		const transcript = await transcriptResponse.json();
		assert.ok(
			transcript.messages.some((message) => message.role === "assistant")
		);
		console.log(
			`${kind}: real Core -> selected ACP runtime -> advisory 78 -> durable transcript`
		);
	}
	for (const name of ["partial-fixture", "error-fixture"]) {
		const response = await fetch(`${base}/api/catalog/scan`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				execution: "agent",
				kind: "agent",
				id: "proof",
				name,
				scorecard: null,
			}),
		});
		const result = await response.json();
		assert.equal(response.status, 200, JSON.stringify(result));
		assert.equal(result.status, "partial");
		assert.equal(result.assessment, null);
		assert.ok(result.conversationId);
		console.log(
			`${name}: partial report without a fabricated score; transcript available`
		);
	}
	console.log(`Default ACP fixture agent: ${agent.id}`);
});
