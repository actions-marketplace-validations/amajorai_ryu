// Standalone browser story for the REAL `InterfaceLevelSubmenu` — the account
// menu's Interface level ladder — mounted inside a real account-shaped
// `DropdownMenu`, opened through its real sub-trigger.
//
// Two things need a browser to be true, and neither is typecheckable:
//
//   1. The fill ramp. `levelFillColor` returns a `color-mix()` over
//      `--effort-top`, a variable that exists only where `LEVEL_RAMP_CLASS` is
//      applied. Forget the class and the declaration is DROPPED — the fill goes
//      colourless rather than falling back to something duller, which a
//      class-name assertion sails straight past.
//   2. A slider hosted in a menu. The menu owns Arrow/Home/End for row
//      navigation and closes on outward pointer activity; the row has to trap
//      keys and not be an item, or nudging the level moves the highlight or
//      shuts the popover.
//
// The story also reads back localStorage, because moving this ladder is supposed
// to WRITE the prefs it implies (Detail level, run stats) rather than shadow
// them — see `src/lib/interface-level.ts`.

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@ryu/ui/components/dropdown-menu";
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { InterfaceLevelSubmenu } from "../../src/components/layout/InterfaceLevelSubmenu.tsx";
import {
	INTERFACE_LEVEL_KEY,
	subscribeInterfaceLevel,
} from "../../src/lib/interface-level.ts";
import "../../src/index.css";

/** The keys the ladder writes, echoed into the DOM for the spec to read. */
const WATCHED = [
	INTERFACE_LEVEL_KEY,
	"ryu:hide-tool-detail",
	"ryu:expand-commands",
	"ryu:inference-stats",
] as const;

function StoredPrefs() {
	// Re-read on every level change — the same store the submenu writes through.
	useSyncExternalStore(
		subscribeInterfaceLevel,
		() => localStorage.getItem(INTERFACE_LEVEL_KEY) ?? "",
		() => ""
	);
	return (
		<dl>
			{WATCHED.map((key) => (
				<div key={key}>
					<dt>{key}</dt>
					<dd data-testid={key}>{localStorage.getItem(key) ?? "unset"}</dd>
				</div>
			))}
		</dl>
	);
}

function Story() {
	return (
		<div style={{ padding: 40 }}>
			<DropdownMenu>
				<DropdownMenuTrigger>Account</DropdownMenuTrigger>
				<DropdownMenuContent className="min-w-56">
					<InterfaceLevelSubmenu />
				</DropdownMenuContent>
			</DropdownMenu>
			<StoredPrefs />
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
