import { describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";

if (typeof document === "undefined") {
	GlobalRegistrator.register();
}

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

function createStreamMock() {
	const signals: AbortSignal[] = [];
	const stream = mock(
		async (_target: unknown, _onEvent: unknown, signal?: AbortSignal) => {
			if (!signal) {
				throw new Error("Expected the hook to own an abort signal");
			}
			signals.push(signal);
		}
	);
	return { signals, stream };
}

const approval = createStreamMock();
const downloads = createStreamMock();
const quests = createStreamMock();
const monitors = createStreamMock();
const desktopNotifications = createStreamMock();

mock.module("@/src/lib/api/approvals.ts", () => ({
	streamApprovalEvents: approval.stream,
}));
mock.module("@/src/lib/api/downloads.ts", () => ({
	streamDownloads: downloads.stream,
}));
mock.module("@/src/lib/api/quests.ts", () => ({
	streamQuestEvents: quests.stream,
}));
mock.module("@/src/lib/api/monitors.ts", () => ({
	streamMonitorAlerts: monitors.stream,
}));
mock.module("@/src/lib/api/events.ts", () => ({
	streamDesktopNotifications: desktopNotifications.stream,
}));

const invalidateQueries = mock(async () => undefined);
mock.module("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries }),
}));
mock.module("@ryu/ui/components/sileo", () => ({
	toast: {
		error: mock(),
		info: mock(),
		success: mock(),
	},
}));

const node = { token: "node-token", url: "https://node.example" };
mock.module("./useActiveNode.ts", () => ({
	useActiveNode: () => node,
}));

const downloadState = {
	applySnapshot: mock(),
	applyUpdate: mock(),
	removeTask: mock(),
	reset: mock(),
};
function useDownloadsStoreMock<T>(
	selector: (state: typeof downloadState) => T
): T {
	return selector(downloadState);
}
mock.module("@/src/store/useDownloadsStore.ts", () => ({
	useDownloadsStore: useDownloadsStoreMock,
}));

const nodeState = { getActiveNode: () => node };
function useNodeStoreMock<T>(selector: (state: typeof nodeState) => T): T {
	return selector(nodeState);
}
mock.module("@/src/store/useNodeStore.ts", () => ({
	useNodeStore: useNodeStoreMock,
}));

const installState = { reset: mock() };
mock.module("@/src/store/useInstallStore.ts", () => ({
	useInstallStore: { getState: () => installState },
}));

const { useApprovalEvents } = await import("./useApprovalEvents.ts");
const { useDownloadsStream } = await import("./useDownloadsStream.ts");
const { useQuestEvents } = await import("./useQuestEvents.ts");
const { useMonitorAlertsStream } = await import("./useMonitorAlertsStream.ts");
const { useDesktopNotificationsStream } = await import(
	"./useDesktopNotificationsStream.ts"
);

function Harness() {
	useApprovalEvents();
	useDownloadsStream();
	useQuestEvents();
	useMonitorAlertsStream();
	useDesktopNotificationsStream();
	return null;
}

const streams = [approval, downloads, quests, monitors, desktopNotifications];

describe("multiplexed event hook lifecycle", () => {
	test("subscribes once per mount and aborts every subscription on cleanup", async () => {
		const container = document.createElement("div");
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
			await Promise.resolve();
		});

		for (const { signals, stream } of streams) {
			expect(stream).toHaveBeenCalledTimes(1);
			expect(stream.mock.calls[0]?.[0]).toEqual(node);
			expect(signals).toHaveLength(1);
			expect(signals[0]?.aborted).toBe(false);
		}

		// The mocked stream resolves immediately. A hook-owned retry loop would make
		// a second call after its old 2s delay; the multiplexer-owned lifecycle does not.
		await new Promise((resolve) => setTimeout(resolve, 2100));
		for (const { stream } of streams) {
			expect(stream).toHaveBeenCalledTimes(1);
		}

		await act(async () => {
			root.unmount();
		});
		for (const { signals } of streams) {
			expect(signals[0]?.aborted).toBe(true);
		}
		container.remove();
	});
});
