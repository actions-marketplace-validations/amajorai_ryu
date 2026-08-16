/* @jsxImportSource @opentui/react */
// Renderer tests for the terminal's declarative-view tier (src/ui/DeclarativeView.tsx)
// — the third renderer of the SAME `ViewSpec` the desktop and the island draw. They
// pin the two things a host renderer must get right: it draws the spec's data, and
// its keyboard is the contract an app's actions are invoked through (numbered
// command row, Enter = primary, y/n confirm gate, silent while unfocused).

import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/ui/theme-provider.tsx";
import { InputFocusProvider } from "../core/InputFocusContext.tsx";
import type { ViewAction, ViewActionContext, ViewSpec } from "../core/views.ts";
import { DeclarativeView } from "../ui/DeclarativeView.tsx";
import { ryuTheme } from "../ui/theme.ts";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(() => {
	testSetup?.renderer.destroy();
	testSetup = null;
});

function Harness({ children }: { children: ReactNode }) {
	return (
		<ThemeProvider theme={ryuTheme}>
			<InputFocusProvider>
				<box flexDirection="column" height="100%" width="100%">
					{children}
				</box>
			</InputFocusProvider>
		</ThemeProvider>
	);
}

async function press(
	setup: Awaited<ReturnType<typeof testRender>>,
	name: string
): Promise<void> {
	const { keyInput } = setup.renderer as unknown as {
		keyInput: { emit: (event: string, data: unknown) => void };
	};
	keyInput.emit("keypress", {
		name,
		sequence: name.length === 1 ? name : "",
		ctrl: false,
		shift: false,
		meta: false,
		option: false,
		eventType: "press",
		repeated: false,
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	await setup.renderOnce();
}

const LIST_SPEC: ViewSpec = {
	view: "list-detail",
	items: [
		{ id: "one", title: "Fix the flaky test", subtitle: "in progress" },
		{ id: "two", title: "Ship the renderer" },
	],
	itemActions: [{ id: "complete", label: "Complete", style: "primary" }],
	actions: [{ id: "refresh", label: "Refresh" }],
};

test("a list-detail spec renders its rows, and the command row numbers its actions", async () => {
	testSetup = await testRender(
		<Harness>
			<DeclarativeView focused={true} spec={LIST_SPEC} />
		</Harness>,
		{ width: 120, height: 20 }
	);
	await testSetup.renderOnce();
	const frame = testSetup.captureCharFrame();
	expect(frame).toContain("Fix the flaky test");
	expect(frame).toContain("in progress");
	expect(frame).toContain("Ship the renderer");
	expect(frame).toContain("1 Complete");
	expect(frame).toContain("2 Refresh");
});

test("an empty list falls back to the spec's own empty text", async () => {
	testSetup = await testRender(
		<Harness>
			<DeclarativeView
				focused={true}
				spec={{ view: "list-detail", items: [], emptyText: "No quests yet." }}
			/>
		</Harness>,
		{ width: 80, height: 12 }
	);
	await testSetup.renderOnce();
	expect(testSetup.captureCharFrame()).toContain("No quests yet.");
});

test("a digit fires the nth action with the selected row as the item context", async () => {
	const fired: { action: ViewAction; ctx: ViewActionContext }[] = [];
	testSetup = await testRender(
		<Harness>
			<DeclarativeView
				focused={true}
				onAction={(action, ctx) => fired.push({ action, ctx })}
				spec={LIST_SPEC}
			/>
		</Harness>,
		{ width: 120, height: 20 }
	);
	await testSetup.renderOnce();

	// j moves to the second row, so the item ctx must carry THAT row.
	await press(testSetup, "j");
	await press(testSetup, "1");
	expect(fired).toHaveLength(1);
	expect(fired[0]?.action.id).toBe("complete");
	expect(fired[0]?.ctx.item?.id).toBe("two");
});

test("Enter fires the primary action; an unfocused view ignores keys entirely", async () => {
	const fired: string[] = [];
	testSetup = await testRender(
		<Harness>
			<DeclarativeView
				focused={false}
				onAction={(action) => fired.push(action.id)}
				spec={LIST_SPEC}
			/>
		</Harness>,
		{ width: 120, height: 20 }
	);
	await testSetup.renderOnce();
	await press(testSetup, "return");
	expect(fired).toEqual([]);

	testSetup.renderer.destroy();
	testSetup = await testRender(
		<Harness>
			<DeclarativeView
				focused={true}
				onAction={(action) => fired.push(action.id)}
				spec={LIST_SPEC}
			/>
		</Harness>,
		{ width: 120, height: 20 }
	);
	await testSetup.renderOnce();
	await press(testSetup, "return");
	expect(fired).toEqual(["complete"]);
});

test("a confirm-carrying action prompts inline and only fires on y", async () => {
	const fired: string[] = [];
	const spec: ViewSpec = {
		view: "list-detail",
		items: [{ id: "one", title: "Only quest" }],
		itemActions: [
			{
				id: "delete",
				label: "Delete",
				style: "danger",
				confirm: "Delete this quest?",
			},
		],
	};
	testSetup = await testRender(
		<Harness>
			<DeclarativeView
				focused={true}
				onAction={(action) => fired.push(action.id)}
				spec={spec}
			/>
		</Harness>,
		{ width: 120, height: 20 }
	);
	await testSetup.renderOnce();

	await press(testSetup, "1");
	expect(fired).toEqual([]);
	expect(testSetup.captureCharFrame()).toContain("Delete this quest?");

	await press(testSetup, "n");
	expect(fired).toEqual([]);

	await press(testSetup, "1");
	await press(testSetup, "y");
	expect(fired).toEqual(["delete"]);
});

test("a data-table spec renders its column headers and rows", async () => {
	testSetup = await testRender(
		<Harness>
			<DeclarativeView
				focused={true}
				spec={{
					view: "data-table",
					columns: [
						{ id: "name", header: "Name" },
						{ id: "status", header: "Status" },
					],
					rows: [
						{ id: "r1", cells: { name: "ryu.app", status: "up" } },
						{ id: "r2", cells: { name: "docs.ryu", status: "down" } },
					],
					actions: [{ id: "check", label: "Check now" }],
				}}
			/>
		</Harness>,
		{ width: 120, height: 20 }
	);
	await testSetup.renderOnce();
	const frame = testSetup.captureCharFrame();
	expect(frame).toContain("Name");
	expect(frame).toContain("Status");
	expect(frame).toContain("ryu.app");
	expect(frame).toContain("down");
	expect(frame).toContain("1 Check now");
});

test("a data-table column's declared align is honoured in the grid", async () => {
	// `ViewColumn.align` is part of the shared vocabulary (the desktop maps it to a
	// text-align class). A monospace grid is where it reads hardest — a right-aligned
	// numeric column is why the field exists — so the terminal must not drop it.
	testSetup = await testRender(
		<Harness>
			<DeclarativeView
				focused={true}
				spec={{
					view: "data-table",
					columns: [
						{ id: "name", header: "Name" },
						{ id: "count", header: "Count", align: "right" },
					],
					rows: [{ id: "r1", cells: { name: "ryu.app", count: "7" } }],
				}}
			/>
		</Harness>,
		{ width: 120, height: 12 }
	);
	await testSetup.renderOnce();
	const frame = testSetup.captureCharFrame();
	// The "count" column is 6 wide (the floor beats its 5-char header), so both the
	// header and the cell hug its right edge and the digit lines up under "t".
	expect(frame).toContain("  Name     Count");
	expect(frame).toContain("› ryu.app      7");
});

test("an empty-state spec renders its title, description and single action", async () => {
	testSetup = await testRender(
		<Harness>
			<DeclarativeView
				focused={true}
				spec={{
					view: "empty-state",
					title: "Nothing recorded",
					description: "Start a capture to see it here.",
					action: { id: "start", label: "Start" },
				}}
			/>
		</Harness>,
		{ width: 80, height: 12 }
	);
	await testSetup.renderOnce();
	const frame = testSetup.captureCharFrame();
	expect(frame).toContain("Nothing recorded");
	expect(frame).toContain("Start a capture to see it here.");
	expect(frame).toContain("1 Start");
});

test("a form spec toggles a switch with space and submits the collected values", async () => {
	const fired: ViewActionContext[] = [];
	testSetup = await testRender(
		<Harness>
			<DeclarativeView
				focused={true}
				onAction={(_action, ctx) => fired.push(ctx)}
				spec={{
					view: "form",
					fields: [
						{ id: "name", label: "Name", type: "text", value: "nightly" },
						{ id: "enabled", label: "Enabled", type: "switch", value: false },
					],
					submit: { id: "save", label: "Save", style: "primary" },
				}}
			/>
		</Harness>,
		{ width: 120, height: 16 }
	);
	await testSetup.renderOnce();
	expect(testSetup.captureCharFrame()).toContain("nightly");

	// j moves to the switch field, space toggles it, Enter submits.
	await press(testSetup, "j");
	await press(testSetup, "space");
	await press(testSetup, "return");
	expect(fired).toHaveLength(1);
	expect(fired[0]?.values).toEqual({ name: "nightly", enabled: true });
});

test("an unknown view kind degrades to a readable line instead of crashing", async () => {
	testSetup = await testRender(
		<Harness>
			{/* A kind from a newer app than this shell — Core forwards it verbatim. */}
			<DeclarativeView
				focused={true}
				spec={{ view: "kanban-board", lanes: [] } as unknown as ViewSpec}
			/>
		</Harness>,
		{ width: 120, height: 12 }
	);
	await testSetup.renderOnce();
	const frame = testSetup.captureCharFrame();
	expect(frame).toContain("Unsupported view kind");
	expect(frame).toContain("kanban-board");
});

// A known kind whose required collection is MISSING. `spec` is opaque to Core, so
// this shape reaches the renderer straight from any manifest; every projection in
// the renderer assumes those arrays exist, and a terminal has no per-pane error
// boundary — an unguarded `spec.items.map` takes the whole shell down through the
// root boundary. Each entry below crashed before `validateView` gated the renderer.
const MALFORMED_SPECS: [string, unknown][] = [
	["list-detail without items", { view: "list-detail" }],
	["data-table without columns", { view: "data-table", rows: [] }],
	["data-table without rows", { view: "data-table", columns: [] }],
	["form without fields", { view: "form" }],
	["filter-bar without filters", { view: "filter-bar" }],
	["stat-card-row without stats", { view: "stat-card-row" }],
	["action-panel without actions", { view: "action-panel" }],
	["empty-state without a title", { view: "empty-state" }],
];

for (const [name, spec] of MALFORMED_SPECS) {
	test(`a malformed spec (${name}) degrades to a readable line instead of crashing`, async () => {
		testSetup = await testRender(
			<Harness>
				<DeclarativeView focused={true} spec={spec as ViewSpec} />
			</Harness>,
			{ width: 120, height: 12 }
		);
		await testSetup.renderOnce();
		const frame = testSetup.captureCharFrame();
		expect(frame).toContain("Unsupported view kind");
		// validateView's explanation is shown so a plugin author sees WHY.
		expect(frame).toContain("must be");
	});
}

test("source-fetched rows replace the spec's static items", async () => {
	testSetup = await testRender(
		<Harness>
			<DeclarativeView
				focused={true}
				sourceItems={[
					{
						item: { id: "s1", title: "From the source" },
						raw: { id: "s1", title: "From the source", extra: 7 },
					},
				]}
				spec={LIST_SPEC}
			/>
		</Harness>,
		{ width: 120, height: 20 }
	);
	await testSetup.renderOnce();
	const frame = testSetup.captureCharFrame();
	expect(frame).toContain("From the source");
	expect(frame).not.toContain("Fix the flaky test");
});
