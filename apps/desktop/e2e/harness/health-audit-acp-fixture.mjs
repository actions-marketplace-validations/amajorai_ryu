// Controlled ACP peer for the real Core audit path. No model or tools run here.
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const fixture = JSON.parse(
	readFileSync(
		new URL(
			"../../../../packages/marketplace/src/catalog/fixtures/agent-audit.json",
			import.meta.url
		),
		"utf8"
	)
);
let sessionCount = 0;
function send(value) {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...value })}\n`);
}
createInterface({ input: process.stdin }).on("line", (line) => {
	let message;
	try {
		message = JSON.parse(line);
	} catch {
		return;
	}
	const { id, method, params } = message;
	if (id === undefined) {
		return;
	}
	if (method === "initialize") {
		send({
			id,
			result: {
				protocolVersion: 1,
				agentCapabilities: {},
				agentInfo: { name: "Health audit fixture", version: "1.0.0" },
			},
		});
		return;
	}
	if (method === "session/new") {
		send({ id, result: { sessionId: `audit-fixture-${++sessionCount}` } });
		return;
	}
	if (method === "session/prompt") {
		const text = params.prompt
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		if (process.env.RYU_AUDIT_FIXTURE_LOG) {
			appendFileSync(
				process.env.RYU_AUDIT_FIXTURE_LOG,
				`${JSON.stringify({
					hasSkill: text.includes("# Ryu health audit"),
					hasEvidence: text.includes("untrusted snapshot"),
					kind: text.match(/Item kind: ([^\n]+)/)?.[1],
				})}\n`
			);
		}
		if (text.includes("Item name: error-fixture")) {
			send({
				id,
				error: { code: -32_603, message: "Controlled agent failure" },
			});
			return;
		}
		const report = text.includes("Item name: partial-fixture")
			? "The evidence is incomplete; no validated score is available."
			: JSON.stringify(fixture.assessment);
		send({
			method: "session/update",
			params: {
				sessionId: params.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: report },
				},
			},
		});
		send({ id, result: { stopReason: "end_turn" } });
		return;
	}
	send({ id, result: {} });
});
