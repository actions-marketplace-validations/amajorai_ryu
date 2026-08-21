import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type UpdateListener = (info: { version?: string }) => void;

const listeners = new Map<string, UpdateListener>();
const quitAndInstall = mock(() => undefined);
const mockedAutoUpdater = {
	autoDownload: false,
	checkForUpdates: mock(async () => undefined),
	checkForUpdatesAndNotify: mock(async () => undefined),
	on: mock((event: string, listener: UpdateListener) => {
		listeners.set(event, listener);
		return mockedAutoUpdater;
	}),
	quitAndInstall,
};
const mockedApp = {
	getVersion: () => "0.1.15",
	isPackaged: true,
};

mock.module("electron", () => ({ app: mockedApp }));
mock.module("electron-updater", () => ({
	default: { autoUpdater: mockedAutoUpdater },
}));
mock.module("./config.ts", () => ({
	coreHeaders: () => ({}),
	loadConfig: () => ({ coreBaseUrl: "http://127.0.0.1:7980" }),
}));

const { initAutoUpdater } = await import("./update.ts");

const originalFetch = globalThis.fetch;
let enabled = true;

beforeEach(() => {
	listeners.clear();
	quitAndInstall.mockClear();
	mockedAutoUpdater.checkForUpdates.mockClear();
	mockedAutoUpdater.checkForUpdatesAndNotify.mockClear();
	enabled = true;
	const mockedFetch = mock(
		async () =>
			new Response(JSON.stringify({ value: JSON.stringify({ enabled }) }), {
				headers: { "Content-Type": "application/json" },
				status: 200,
			})
	) as unknown as typeof fetch;
	globalThis.fetch = mockedFetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

async function flushPreferenceRead(): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});
}

describe("Electron updater install wiring", () => {
	test("silently installs and relaunches after an enabled download", async () => {
		initAutoUpdater(() => null);
		listeners.get("update-downloaded")?.({ version: "0.1.16" });
		await flushPreferenceRead();

		expect(quitAndInstall).toHaveBeenCalledWith(true, true);
	});

	test("keeps the restart under user control when auto-updates are disabled", async () => {
		enabled = false;
		initAutoUpdater(() => null);
		listeners.get("update-downloaded")?.({ version: "0.1.17" });
		await flushPreferenceRead();

		expect(quitAndInstall).not.toHaveBeenCalled();
	});
});
