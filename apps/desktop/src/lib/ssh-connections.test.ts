import { beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
	loadSshConnections,
	SSH_CONNECTIONS_STORAGE_KEY,
	saveSshConnections,
} from "./ssh-connections.ts";

if (typeof document === "undefined") {
	GlobalRegistrator.register();
}

beforeEach(() => {
	localStorage.removeItem(SSH_CONNECTIONS_STORAGE_KEY);
});

describe("SSH connection profiles", () => {
	test("round-trips connection metadata without private-key contents", () => {
		const connections = [
			{
				auth: "identity" as const,
				host: "server.example.com",
				identityFile: "~/.ssh/id_ed25519",
				id: "server-1",
				name: "Build server",
				port: 2222,
				username: "deploy",
			},
		];

		saveSshConnections(connections);

		expect(loadSshConnections()).toEqual(connections);
		expect(localStorage.getItem(SSH_CONNECTIONS_STORAGE_KEY)).not.toContain(
			"PRIVATE KEY"
		);
	});

	test("drops malformed records and duplicate ids", () => {
		localStorage.setItem(
			SSH_CONNECTIONS_STORAGE_KEY,
			JSON.stringify([
				{
					auth: "none",
					host: "host.example.com",
					id: "same",
					name: "First",
					port: 22,
					username: "user",
				},
				{
					host: "host.example.com",
					id: "same",
					name: "Duplicate",
					port: 22,
					username: "user",
				},
				{
					host: "bad host",
					name: "Invalid",
					port: 22,
				},
			])
		);

		expect(loadSshConnections()).toHaveLength(1);
		expect(loadSshConnections()[0]?.name).toBe("First");
	});
});
