// Standalone browser story for the REAL Store/Library page chrome:
// `StoreSectionTabs` (the pill section strip with its scrolled-edge fade) and
// `StoreBottomSearch` (the bare, bottom-pinned global search field), both
// exported from `packages/blocks/src/desktop/store.tsx`.
//
// Both are prop-driven presentational components, so they mount without Core,
// Tauri or seed data. The third panel mirrors StorePage's structural shell —
// `relative` page root, a padded scrolling column, the bar positioned out of
// flow — because that arrangement is what makes the last row reachable, and a
// component rendered on its own cannot show it.

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
	StoreBottomSearch,
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
 * StorePage's shell in miniature, mirroring the three things that make the
 * bottom bar behave: a `relative` page root, a scrolling column padded by the
 * bar's height, and the bar positioned out of flow at the bottom.
 *
 * The last child is a stand-in for the shell's split-pane badge (`Layout.tsx` →
 * `PaneBadge`): same box (`absolute bottom-2 left-2 z-10`), and rendered AFTER
 * the page the way Layout renders it after `<RouteOutlet>`. It is what the
 * bottom bar shares this corner with, and a `z-30` on the bar erased it.
 *
 * The real badge wrapper also carries `pointer-events-none` (so content behind
 * stays clickable); the stand-in drops it because hit-testing is how the test
 * reads PAINT order — `elementFromPoint` skips a `pointer-events: none` box, and
 * the question here is which of the two is on top, not which is clickable.
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
				<div className="min-h-0 flex-1 overflow-hidden pb-14">
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
				<StoreBottomSearch
					onChange={setQuery}
					placeholder="Search the whole marketplace…"
					value={query}
				/>
			</div>
			<div
				className="absolute bottom-2 left-2 z-10 flex h-8 items-center gap-1.5"
				data-testid={`${testid}-badge`}
			>
				<div className="flex h-6 items-center rounded-full bg-primary px-2.5 font-medium text-primary-foreground text-xs">
					Store
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
