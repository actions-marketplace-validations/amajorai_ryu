// Standalone browser story for the REAL `AppIcon` — the one icon square every
// surface renders (Store lists, Installed tab, sidebar, workspace tab strips, the
// composer "+" menu).
//
// It exists because the icon's legibility is a property of the PAINTED PIXELS, not
// of the manifest data, and it fails in only one theme at a time. Every packaged
// manifest now declares the standard `{from: <hue>, to: "transparent", direction:
// "down"}` wash, which covers only the top of the square; the square's bottom is
// whatever surface is behind it. A hardcoded white glyph on that reads perfectly on
// a dark card and vanishes completely on a light one — so a story that renders one
// theme, or that asserts on props instead of pixels, would certify nothing.
//
// Both themes are mounted side by side, over the real `bg-card`, with the real
// hues taken from the shipped manifests. Screenshot it and look: every glyph must
// be readable in BOTH columns.

import AppIcon from "@ryu/marketplace/catalog/chrome/app-icon";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

/** Real ids, glyphs and hues, copied from the shipped manifests — spanning the
 *  wheel so a hue that only fails in one sector cannot hide. */
const SAMPLES: Array<{ hue: number; icon: string; id: string; name: string }> =
	[
		{ hue: 8, icon: "ai-brain-01", id: "@ryu/finetune", name: "Finetune" },
		{
			hue: 53,
			icon: "pulse-01",
			id: "@ryu/agent-status",
			name: "Agent Status",
		},
		{ hue: 96, icon: "shapes", id: "@ryu/whiteboard", name: "Whiteboard" },
		{ hue: 138, icon: "activity-03", id: "@ryu/activity", name: "Activity" },
		{ hue: 185, icon: "brain-01", id: "@ryu/memory", name: "Memory" },
		{
			hue: 233,
			icon: "workflow-circle-06",
			id: "@ryu/workflows",
			name: "Workflows",
		},
		{ hue: 275, icon: "bulb", id: "@ryu/advisor", name: "Advisor" },
		{ hue: 318, icon: "webhook", id: "@ryu/webhooks", name: "Webhooks" },
		{ hue: 348, icon: "film-01", id: "@ryu/clips", name: "Clips" },
	];

function Row({ label }: { label: string }) {
	return (
		<div className="flex flex-wrap gap-4 rounded-xl bg-card p-4">
			{SAMPLES.map((s) => (
				<div className="w-20 text-center" data-testid="tile" key={s.id}>
					<AppIcon
						className="mx-auto size-14"
						dither={{ direction: "down", from: s.hue, to: "transparent" }}
						iconId={s.icon}
						name={s.name}
						seedId={s.id}
						size={26}
					/>
					<div className="mt-1 truncate text-[10px] text-muted-foreground">
						{s.name}
					</div>
				</div>
			))}
			<div className="w-full pt-1 text-[10px] text-muted-foreground">
				{label}
			</div>
		</div>
	);
}

function Story() {
	return (
		<div className="grid grid-cols-2">
			<div className="light bg-background p-6 text-foreground">
				<Row label="light theme — standard wash, theme-foreground glyph" />
			</div>
			<div className="dark bg-background p-6 text-foreground">
				<Row label="dark theme — standard wash, theme-foreground glyph" />
			</div>
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
