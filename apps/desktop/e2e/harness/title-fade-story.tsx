// Standalone browser story for the REAL edge-fade label family exported from
// `src/components/layout/overflow-tooltip.tsx` — `FadeLabel` (sidebar chat rows,
// which carry their own hover preview) and `OverflowTooltip fade` (tab titles),
// plus the legacy `AutoScrollText` label that must remain static.
//
// What only a real browser can settle: whether the clipped-edge mask engages at
// all. The decision is a LAYOUT measurement, so happy-dom cannot judge it — every
// width there is 0. The rows below reproduce the two shapes the app puts these
// labels in, with the case that used to fail: one unbroken 200-character token,
// with no space anywhere for the line to break at.
//
// `legacy` is the pre-fix shape kept as a control: a bare inline <span> carrying
// the caller's `overflow-hidden whitespace-nowrap`. `overflow` does not apply to
// an inline box, so it reports clientWidth 0 and scrollWidth 0 — which is exactly
// why the old single-element `scrollWidth > clientWidth` check decided "not
// clipped" and never faded, no matter how long the text was.

import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
	FadeLabel,
	OverflowTooltip,
} from "../../src/components/layout/overflow-tooltip.tsx";
import { AutoScrollText } from "../../src/components/shell/AutoScrollText.tsx";
import "../../src/index.css";

const UNBROKEN = "z".repeat(200);
const SPACED =
	"A very long conversation title that certainly does not fit here";
const SHORT = "Short";

/** The sidebar chat row: a flex row whose title slot is a block-level wrapper
 *  (Base UI's preview-card trigger), matching `AppSidebar`'s chat rows. */
function Row({
	children,
	testid,
}: {
	children: React.ReactNode;
	testid: string;
}) {
	return (
		<div className="flex h-8 w-[220px] items-center gap-2 rounded-md bg-muted/40 px-2">
			<span className="size-4 shrink-0 rounded-full bg-foreground/20" />
			{/* The title slot: a blockified flex item, like the preview-card trigger
			    the sidebar chat rows hang their title inside. The label under test is
			    its FIRST child span. */}
			<span className="min-w-0 flex-1" data-testid={testid}>
				{children}
			</span>
		</div>
	);
}

function Story() {
	const [title, setTitle] = useState("Old title");

	return (
		<div className="flex flex-col gap-4 p-6">
			<div className="flex items-center gap-2">
				<button
					data-testid="rename-title"
					onClick={() => setTitle("New title")}
					type="button"
				>
					Rename
				</button>
				<span className="min-w-0 flex-1 text-sm" data-testid="animated-title">
					<OverflowTooltip fade text={title} />
				</span>
			</div>
			<Row testid="fade-unbroken">
				<FadeLabel className="flex-1 text-sm" text={UNBROKEN} />
			</Row>
			<Row testid="fade-spaced">
				<FadeLabel className="flex-1 text-sm" text={SPACED} />
			</Row>
			<Row testid="fade-shimmer">
				<FadeLabel className="flex-1 text-sm" shimmer text={UNBROKEN} />
			</Row>
			<Row testid="fade-short">
				<FadeLabel className="flex-1 text-sm" text={SHORT} />
			</Row>
			<Row testid="auto-scroll-text">
				<AutoScrollText className="flex-1 text-sm" title={UNBROKEN}>
					{UNBROKEN}
				</AutoScrollText>
			</Row>
			<Row testid="tooltip-shimmer">
				<OverflowTooltip
					className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm"
					fade
					shimmer
					text={UNBROKEN}
				/>
			</Row>
			<Row testid="tooltip-resting">
				<OverflowTooltip
					className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm"
					fade
					text={UNBROKEN}
				/>
			</Row>
			<Row testid="legacy">
				<span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm">
					{UNBROKEN}
				</span>
			</Row>
		</div>
	);
}

const container = document.getElementById("root");
if (container) {
	createRoot(container).render(<Story />);
}
