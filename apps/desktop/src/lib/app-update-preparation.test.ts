import { describe, expect, it } from "bun:test";
import {
	createAppUpdatePreparationCoordinator,
	type PrepareAppUpdateRequest,
	type PreparedAppUpdate,
} from "./app-update-preparation.ts";

function prepared(version = "0.2.1"): PreparedAppUpdate {
	return {
		artifactFile: `ryu-update-${version}.bin`,
		artifactSize: 4096,
		schemaVersion: 1,
		signature: "signed-fixture",
		source: { kind: "stable" },
		version,
	};
}

describe("app update preparation coordinator", () => {
	it("defaults automatic downloading on when Tauri is unavailable", async () => {
		const coordinator = createAppUpdatePreparationCoordinator(() =>
			Promise.reject(new Error("not running in Tauri"))
		);

		await expect(coordinator.getAutomaticDownload()).resolves.toBe(true);
	});

	it("deduplicates concurrent preparation of the same version", async () => {
		const calls: string[] = [];
		let finish: ((value: unknown) => void) | undefined;
		const coordinator = createAppUpdatePreparationCoordinator((command) => {
			calls.push(command);
			return new Promise((resolve) => {
				finish = resolve;
			});
		});
		const request = {
			expectedVersion: "0.2.1",
			source: { kind: "stable" },
		} satisfies PrepareAppUpdateRequest;

		const first = coordinator.prepare(request);
		const second = coordinator.prepare(request);
		expect(first).toBe(second);
		finish?.(prepared());

		await expect(first).resolves.toEqual(prepared());
		expect(calls).toEqual(["prepare_app_update"]);
		expect(coordinator.getSnapshot()).toEqual({
			kind: "ready",
			update: prepared(),
		});
	});

	it("rejects malformed prepared state at the IPC boundary", async () => {
		const coordinator = createAppUpdatePreparationCoordinator(() =>
			Promise.resolve({
				artifactFile: "../../outside",
				artifactSize: 1,
				kind: "stable",
			})
		);

		await expect(coordinator.refresh()).rejects.toThrow(
			"Invalid prepared app update"
		);
	});

	it("installs only the already prepared artifact", async () => {
		const calls: string[] = [];
		const coordinator = createAppUpdatePreparationCoordinator((command) => {
			calls.push(command);
			return Promise.resolve(command === "install_prepared_app_update");
		});

		await expect(coordinator.install()).resolves.toBe(true);
		expect(calls).toEqual(["install_prepared_app_update"]);
		expect(coordinator.getSnapshot()).toEqual({ kind: "empty" });
	});

	it("publishes ready and cleared state changes to subscribers", async () => {
		const coordinator = createAppUpdatePreparationCoordinator((command) => {
			if (command === "get_prepared_app_update") {
				return Promise.resolve(prepared());
			}
			return Promise.resolve(null);
		});
		const seen: string[] = [];
		const unsubscribe = coordinator.subscribe(() => {
			seen.push(coordinator.getSnapshot().kind);
		});

		await coordinator.refresh();
		await coordinator.clear();
		unsubscribe();

		expect(seen).toEqual(["ready", "empty"]);
	});
});
