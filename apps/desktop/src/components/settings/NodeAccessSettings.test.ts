import { describe, expect, test } from "bun:test";
import {
	canRevokePairedClient,
	describePairingConstraints,
	formatPairingTimestamp,
	getPairedClientStatus,
	narrowPairingScopes,
	type PairedClient,
} from "./NodeAccessSettings.model.ts";

function client(overrides: Partial<PairedClient> = {}): PairedClient {
	return {
		active: true,
		created_at: 100,
		id: "client-1",
		last_seen: 100,
		name: "Ryu Web",
		...overrides,
	};
}

describe("pairing grant display", () => {
	test("does not throw for invalid or out-of-range timestamps", () => {
		expect(formatPairingTimestamp(0)).toBeNull();
		expect(formatPairingTimestamp(Number.MAX_SAFE_INTEGER)).toBeNull();
		expect(formatPairingTimestamp(Number.NaN)).toBeNull();
	});
	test("labels every exact credential binding", () => {
		expect(
			describePairingConstraints({
				agent_id: "agent-1",
				client_id: "client-1",
				node_id: "node-1",
				org_id: "org-1",
				plugin_id: "plugin-1",
				resource_id: "resource-1",
				subject_id: "user-1",
				team_id: "team-1",
				tool_name: "search",
			})
		).toEqual([
			"User: user-1",
			"Client: client-1",
			"Node: node-1",
			"Organization: org-1",
			"Team: team-1",
			"Agent: agent-1",
			"Plugin: plugin-1",
			"Resource: resource-1",
			"Tool: search",
		]);
	});

	test("calls an empty constraint set unbound", () => {
		expect(describePairingConstraints({})).toEqual(["Unbound"]);
		expect(describePairingConstraints(undefined)).toEqual(["Unbound"]);
	});

	test("distinguishes active, inactive, expired, and revoked clients", () => {
		expect(getPairedClientStatus(client(), 200)).toBe("Active");
		expect(getPairedClientStatus(client({ active: false }), 200)).toBe(
			"Inactive"
		);
		expect(
			getPairedClientStatus(client({ active: false, expires_at: 199 }), 200)
		).toBe("Expired");
		expect(
			getPairedClientStatus(
				client({ active: false, expires_at: 199, revoked_at: 150 }),
				200
			)
		).toBe("Revoked");
	});

	test("only active clients offer revocation", () => {
		expect(canRevokePairedClient(client(), 200)).toBe(true);
		expect(canRevokePairedClient(client({ active: false }), 200)).toBe(false);
		expect(canRevokePairedClient(client({ expires_at: 199 }), 200)).toBe(false);
		expect(canRevokePairedClient(client({ revoked_at: 150 }), 200)).toBe(false);
	});

	test("narrows scopes without allowing an unrequested capability", () => {
		const requested = ["chat:read", "chat:write", "tools:read"];
		const selected = narrowPairingScopes({
			checked: false,
			requested,
			scope: "chat:write",
			selected: requested,
		});
		expect(selected).toEqual(["chat:read", "tools:read"]);
		expect(
			narrowPairingScopes({
				checked: true,
				requested,
				scope: "agents:manage",
				selected,
			})
		).toEqual(selected);
	});
});
