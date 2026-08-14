// Standalone browser story for the REAL Store/Library page chrome:
// `StoreSectionTabs` (the pill section strip, scrolled through the shared
// `EdgeScroller`) and `StoreGlobalSearch` (the large muted search pill), both
// exported from `packages/blocks/src/desktop/store.tsx`.
//
// Both are prop-driven presentational components, so they mount without Core,
// Tauri or seed data. The third panel mirrors StorePage's structural shell —
// search over tabs over a scrolling column — because the ORDER is the claim: the
// control that searches everything sits above the tabs that scope a search to one
// realm, not below them.

import {
	AppleIcon,
	CpuIcon,
	GridIcon,
	Home01Icon,
	PuzzleIcon,
	Rocket01Icon,
	Settings01Icon,
	SparklesIcon,
	UserGroupIcon,
	Wallet01Icon,
} from "@hugeicons/core-free-icons";
import {
	StoreGlobalSearch,
	type StoreSectionTab,
	StoreSectionTabs,
} from "@ryu/blocks/desktop/store";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

const MANY: StoreSectionTab[] = [
	{ group: "discover", icon: Home01Icon, label: "Home", value: "home" },
	{ group: "discover", icon: GridIcon, label: "Apps", value: "apps" },
	{ group: "discover", icon: PuzzleIcon, label: "Plugins", value: "plugins" },
	{ group: "discover", icon: SparklesIcon, label: "Agents", value: "agents" },
	{
		group: "build",
		icon: Rocket01Icon,
		label: "Workflows",
		value: "workflows",
	},
	{ group: "build", icon: CpuIcon, label: "Models", value: "models" },
	{ group: "build", icon: AppleIcon, label: "Engines", value: "engines" },
	{ group: "manage", icon: UserGroupIcon, label: "Teams", value: "teams" },
	{
		group: "manage",
		icon: Settings01Icon,
		label: "Installed",
		value: "installed",
	},
	{ group: "account", icon: Wallet01Icon, label: "Account", value: "account" },
];

const FEW: StoreSectionTab[] = MANY.slice(0, 2);

/**
 * StorePage's shell in miniature: the global search over the section tabs over a
 * scrolling content column, all in the page flow.
 *
 * Nothing is positioned out of flow any more. The search used to be an
 * `absolute` bar pinned to the bottom, which is why this story also carried a
 * stand-in for the shell's split-pane badge (the one thing that shared that
 * corner, and that a z-index on the bar erased). With the field in the flow at
 * the top, neither the overlap nor the padding dance it needed exists.
 */
function PageShell({ testid, width }: { testid: string; width: number }) {
	const [query, setQuery] = useState("");
	return (
		<section
			className="relative flex flex-col overflow-hidden rounded-xl border border-border"
			data-testid={`${testid}-shell`}
			style={{ height: 320, width }}
		>
			<div className="relative flex h-full flex-col overflow-hidden">
				<div className="shrink-0 px-4 pt-4">
					<StoreGlobalSearch
						onChange={setQuery}
						placeholder="Search the whole marketplace…"
						value={query}
					/>
					<StoreSectionTabs
						active="home"
						className="pt-2 pb-1"
						sections={MANY}
					/>
				</div>
				<div className="min-h-0 flex-1 overflow-hidden">
					<div
						className="h-full overflow-auto p-4"
						data-testid={`${testid}-scroller`}
					>
						{Array.from({ length: 30 }, (_, i) => i).map((i) => (
							<div
								className="border-border/60 border-b py-2 text-sm"
								data-testid={i === 29 ? `${testid}-last-row` : "row"}
								key={i}
							>
								Row {i}
							</div>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}

function Story() {
	const [wideActive, setWideActive] = useState("home");
	const [narrowActive, setNarrowActive] = useState("home");

	return (
		// `bg-background` on the page itself: the bottom search bar is opaque and
		// takes the theme background, so a story on a bare white body would hide
		// whether it actually covers what scrolls under it in dark mode.
		<div className="flex min-h-screen flex-col gap-8 bg-background p-6 text-foreground">
			{/* Overflowing strip: 10 sections in a 420px column, so both the scroll
			    and the edge fade are exercised. */}
			<section data-testid="narrow-panel" style={{ width: 420 }}>
				<p className="pb-2 font-semibold text-lg">Marketplace</p>
				<StoreSectionTabs
					active={narrowActive}
					className="pt-2 pb-1"
					onSelect={setNarrowActive}
					sections={MANY}
				/>
			</section>

			{/* Non-overflowing strip: two sections with room to spare, so the fade
			    must NOT engage. */}
			<section data-testid="wide-panel" style={{ width: 900 }}>
				<p className="pb-2 font-semibold text-lg">Library</p>
				<StoreSectionTabs
					active={wideActive}
					className="pt-2 pb-1"
					onSelect={setWideActive}
					sections={FEW}
				/>
			</section>

			{/* A roomy pane, and a deliberately cramped one. The narrow shell is where
			    the bar has to hold up: 360px is about the narrowest a split pane gets
			    before the shell stops splitting, and it is also where the pane badge
			    and the input row overlap most. */}
			<PageShell testid="page" width={640} />
			<PageShell testid="cramped" width={360} />
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
