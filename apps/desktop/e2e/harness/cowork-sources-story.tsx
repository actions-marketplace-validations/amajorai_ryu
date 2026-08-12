// Standalone browser story for the REAL `CoworkContextPanel` Sources section —
// the "what did this run actually touch" list in the pinned summary rail.
//
// The section used to render one row per CONNECTOR ("Web search", "Local files")
// and nothing else, so a user could see THAT the run searched the web without
// ever seeing WHICH links or files. Each connector now expands in place.
//
// This is a real-browser story rather than a unit test because the expansion is
// nested inside the `BouncyAccordion`, whose open height comes from a
// `ResizeObserver` on its content: a group that expands into a fixed-height box
// would pin `offsetHeight` and the section would clip its own list. Only a real
// layout engine says whether the outer section actually grows.
//
// The panel is mounted with `runId={null}` so it makes no Core requests — every
// section here is derived from the message stream alone, which is exactly the
// substrate under test.

import { createRoot } from "react-dom/client";
import { CoworkContextPanel } from "../../src/components/panels/CoworkContextPanel.tsx";
import "../../src/index.css";

const MESSAGES = [
	{
		role: "user",
		parts: [{ type: "text", text: "Look into the effort slider colours." }],
	},
	{
		role: "assistant",
		parts: [
			{
				type: "tool-Grep",
				state: "output-available",
				input: { pattern: "effortFillColor", path: "apps/desktop/src" },
			},
			{
				type: "tool-Read",
				state: "output-available",
				input: {
					file_path:
						"/repo/apps/desktop/components/agent-elements/input/effort-slider-row.tsx",
				},
			},
			{
				type: "tool-Edit",
				state: "output-available",
				input: { file_path: "/repo/apps/desktop/src/lib/effort-colors.ts" },
			},
			{
				type: "tool-Bash",
				state: "output-available",
				input: { command: "bun test src/lib/effort-colors.test.ts" },
			},
			{
				type: "tool-WebFetch",
				state: "output-available",
				input: { url: "https://oklch.com/" },
				output: { title: "OKLCH colour picker" },
			},
			{
				type: "tool-WebSearch",
				state: "output-available",
				input: { query: "oklch interpolation gamut clipping" },
				output: {
					results: [
						{
							title: "Colour interpolation in CSS",
							url: "https://developer.mozilla.org/color_interpolation",
						},
						{
							title: "Gamut mapping explained",
							url: "https://evilmartians.com/gamut-mapping",
						},
					],
				},
			},
			{
				type: "dynamic-tool",
				toolName: "mcp__linear__create_issue",
				state: "output-available",
				input: { name: "Brighten the dark-mode ramp" },
			},
		],
	},
];

function Story() {
	return (
		<div className="h-screen w-[420px] bg-background text-foreground">
			<CoworkContextPanel
				messages={MESSAGES}
				runId={null}
				target={{ url: "http://localhost:0", token: null }}
			/>
		</div>
	);
}

const container = document.getElementById("root");
if (container) {
	createRoot(container).render(<Story />);
}
