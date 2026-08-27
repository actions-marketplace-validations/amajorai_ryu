import { expect, mock, test } from "bun:test";

const opened: string[] = [];
mock.module("@/lib/tauri-bridge.ts", () => ({
	openExternal: async (url: string) => {
		opened.push(url);
	},
}));

const { openFeedbackWidget } = await import("./userjot.ts");

test("opens feedback outside the privileged webview", async () => {
	await openFeedbackWidget("dark");
	expect(opened).toEqual(["https://ryuhq.userjot.com/"]);
});
