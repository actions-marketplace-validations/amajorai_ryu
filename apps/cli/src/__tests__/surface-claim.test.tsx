/* @jsxImportSource @opentui/react */
// End-to-end test of the seam that RETIRES a bespoke surface: with the contributions
// feed stubbed, a built-in screen (here /calendar) renders the plugin's declarative
// view instead of its hand-written body, and falls back to that body when no app
// claims it. This is the whole point of the `views` contribution — the shell stops
// re-implementing an app's UI — so it is pinned at the surface level, through the
// real provider stack and the real router, not just at the helper level.

import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { ThemeProvider } from "@/components/ui/theme-provider.tsx";
import { ChatIntentProvider } from "../core/ChatIntentContext.tsx";
import { ContributionsProvider } from "../core/ContributionsContext.tsx";
import { CoreProvider } from "../core/CoreContext.tsx";
import { InputFocusProvider } from "../core/InputFocusContext.tsx";
import { OverlayProvider } from "../overlays/OverlayHost.tsx";
import { TerminalThemeProvider } from "../ui/TerminalThemeProvider.tsx";
import { ryuTheme } from "../ui/theme.ts";
import { ToastProvider } from "../ui/toast.tsx";
import { SplitView } from "../workspace/SplitView.tsx";
import {
	useWorkspace,
	WorkspaceProvider,
} from "../workspace/WorkspaceContext.tsx";

const LOCAL_TARGET = { url: "http://127.0.0.1:7980", token: null };

const CLAIMING_PAYLOAD = {
	views: [
		{
			id: "surface:calendar",
			plugin: "com.example.calendar",
			title: "Agenda",
			view: "list-detail",
			spec: {
				view: "list-detail",
				items: [
					{
						id: "standup",
						title: "Daily standup",
						subtitle: "weekdays at 09:00",
					},
				],
				itemActions: [{ id: "open", label: "Open", style: "primary" }],
			},
		},
	],
};

const realFetch = globalThis.fetch;
let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;
let ws: ReturnType<typeof useWorkspace> | null = null;

afterEach(() => {
	globalThis.fetch = realFetch;
	testSetup?.renderer.destroy();
	testSetup = null;
	ws = null;
});

/** Answer the contributions endpoint with `payload`; every other Core read (the
 *  built-in surfaces' own fetches) resolves empty so nothing hangs. */
function stubCore(payload: unknown): void {
	globalThis.fetch = ((input: unknown) => {
		const url = String(
			typeof input === "string" ? input : (input as { url?: string }).url
		);
		const body = url.includes("/api/plugins/contributions") ? payload : {};
		return Promise.resolve(
			new Response(JSON.stringify(body), {
				status: 200,
				headers: { "content-type": "application/json" },
			})
		);
	}) as typeof fetch;
}

function Capture() {
	ws = useWorkspace();
	return null;
}

function Harness() {
	return (
		<ThemeProvider theme={ryuTheme}>
			<CoreProvider initial={LOCAL_TARGET}>
				<TerminalThemeProvider>
					<ContributionsProvider>
						<InputFocusProvider>
							<ToastProvider>
								<ChatIntentProvider>
									<WorkspaceProvider>
										<OverlayProvider>
											<Capture />
											<box flexDirection="column" height="100%" width="100%">
												<SplitView />
											</box>
										</OverlayProvider>
									</WorkspaceProvider>
								</ChatIntentProvider>
							</ToastProvider>
						</InputFocusProvider>
					</ContributionsProvider>
				</TerminalThemeProvider>
			</CoreProvider>
		</ThemeProvider>
	);
}

async function flush(
	setup: Awaited<ReturnType<typeof testRender>>
): Promise<void> {
	for (let i = 0; i < 4; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await setup.renderOnce();
	}
}

test("a claiming contribution replaces the built-in Calendar body", async () => {
	stubCore(CLAIMING_PAYLOAD);
	testSetup = await testRender(<Harness />, { width: 120, height: 30 });
	await flush(testSetup);

	ws?.openTab("/calendar");
	await flush(testSetup);

	const frame = testSetup.captureCharFrame();
	// The app's data, rendered by the terminal's own renderer…
	expect(frame).toContain("Daily standup");
	expect(frame).toContain("1 Open");
	// …in place of the hand-written agenda's hint line.
	expect(frame).not.toContain("Enter open Tasks");
	expect(frame).not.toContain("Error:");
});

test("a claim whose spec cannot draw leaves the built-in Calendar body up", async () => {
	// `spec` is opaque to Core, so a manifest can declare a known kind without the
	// collection it is made of. Handing the screen over anyway would replace a
	// working agenda with an "unsupported view" line — the regression the claim
	// gate exists to prevent — and, before the renderer validated, would take the
	// whole terminal down through the root error boundary.
	stubCore({
		views: [
			{
				id: "surface:calendar",
				plugin: "com.example.calendar",
				title: "Agenda",
				view: "list-detail",
				spec: { view: "list-detail" },
			},
		],
	});
	testSetup = await testRender(<Harness />, { width: 120, height: 30 });
	await flush(testSetup);

	ws?.openTab("/calendar");
	await flush(testSetup);

	const frame = testSetup.captureCharFrame();
	expect(frame).toContain("Enter open Tasks");
	expect(frame).not.toContain("Unsupported view kind");
	expect(frame).not.toContain("Error:");
});

test("with no claiming contribution the built-in Calendar body still renders", async () => {
	stubCore({ views: [] });
	testSetup = await testRender(<Harness />, { width: 120, height: 30 });
	await flush(testSetup);

	ws?.openTab("/calendar");
	await flush(testSetup);

	const frame = testSetup.captureCharFrame();
	expect(frame).toContain("Enter open Tasks");
	expect(frame).not.toContain("Daily standup");
});
