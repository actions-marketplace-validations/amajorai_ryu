// Standalone browser story for the composer's "+" affordance on the REAL shared
// `InputBar` (`@ryu/blocks/desktop/agent-elements/input-bar`) — the one bar the
// chat page, the launchpad, the Ask Ryu dock and the builder panes all render.
//
// What it certifies: the "+" is a DROPDOWN on every surface, including one that
// wires nothing but attach. That regressed silently for a long time — the toolbar
// decided whether to open a menu from the *optional* rows a host supplied (goal,
// ghost, plugin toggles, image/video gen), so the chat page (which wires four of
// them) got a menu while the launchpad and builder panes (which wire none) got a
// bare button that opened the OS file picker. A build can't catch that: both
// spellings compile. Only clicking it can.
//
// Two mounts stand in for the two ends of the range:
//   - "minimal"  — attach only, the launchpad/builder-pane shape
//   - "full"     — attach + temporary chat + a plugin toggle, the chat-page shape
// Both must open the same popover; the second just carries more rows.
//
// Hermetic by construction: `InputBar` is presentational, so no Core node, no
// Tauri, and none of the desktop's context tree is involved.

import { InputBar } from "@ryu/blocks/desktop/agent-elements/input-bar";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

function noop() {
	return undefined;
}

function Story() {
	const [attachCount, setAttachCount] = useState(0);
	const [ghost, setGhost] = useState(false);
	const [flag, setFlag] = useState(false);

	return (
		<div className="flex min-h-screen flex-col gap-8 bg-background p-6">
			{/* The launchpad / builder-pane shape: attach is the ONLY row wired. */}
			<section className="flex flex-col gap-2" data-testid="minimal">
				<h2 className="font-medium text-sm">Attach only</h2>
				<InputBar
					onAttach={() => setAttachCount((n) => n + 1)}
					onSend={noop}
					onStop={noop}
					placeholder="What do you want to do?"
					status="ready"
				/>
			</section>

			{/* The chat-page shape: the same menu, carrying its extra rows. */}
			<section className="flex flex-col gap-2" data-testid="full">
				<h2 className="font-medium text-sm">
					Attach + temporary chat + plugin
				</h2>
				<InputBar
					ghostControls={{ active: ghost, onToggle: () => setGhost((o) => !o) }}
					onAttach={() => setAttachCount((n) => n + 1)}
					onSend={noop}
					onStop={noop}
					pluginControls={[
						{
							id: "double-check",
							flag: "double_check",
							label: "Double-check",
							enabled: flag,
							onToggle: (_f, next) => setFlag(next),
						},
					]}
					status="ready"
				/>
			</section>

			{/* Read back by the spec: proves the attach ROW inside the popover still
			    reaches the host's handler, not just that a menu rendered. */}
			<output data-testid="attach-count">{attachCount}</output>
			<output data-testid="ghost-state">{ghost ? "on" : "off"}</output>
		</div>
	);
}

const container = document.getElementById("root");
if (container) {
	createRoot(container).render(<Story />);
}
