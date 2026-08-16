// apps/desktop/src/components/shell/SafeModeBanner.tsx
//
// A persistent marker while the node is booted in Safe Mode.
//
// Without it the mode is a trap: apps are missing, skills stop firing and slash
// commands vanish, with nothing on screen connecting that to a switch the user
// flipped days ago. Every "my plugin disappeared" report would be this. So the
// banner is not decoration — it is the thing that makes a sticky diagnostic mode
// safe to ship.
//
// It reads Core, not a local preference: Safe Mode can also be forced on by
// `RYU_SAFE_MODE` or the `~/.ryu/safe-mode` sentinel, and a client-side flag would
// stay silent on exactly the nodes that most need the marker.

import { Alert01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@ryu/ui/components/button";
import { toast } from "@ryu/ui/components/sileo.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { restartRyuCore } from "@/lib/tauri-bridge.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	applySafeMode,
	fetchSafeMode,
	type SafeModeState,
} from "@/src/lib/api/safe-mode.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";

/**
 * Re-read cadence. Slow on purpose: the state only changes across a Core restart,
 * so this is a correction for a node swap or an out-of-band flip, not a poll of
 * something live.
 */
const POLL_INTERVAL_MS = 60_000;

export function SafeModeBanner() {
	// No tab context in the shell, so resolve the active node and derive the
	// target in the render body — same reason as `SupportAccessBanner`.
	const node = useNodeStore((s) => s.getActiveNode());
	const target: ApiTarget = useMemo(
		() => ({ token: node.token ?? null, url: node.url }),
		[node.token, node.url]
	);

	const [state, setState] = useState<SafeModeState | null>(null);
	const [leaving, setLeaving] = useState(false);
	const cancelledRef = useRef(false);

	const refresh = useCallback(async () => {
		try {
			const next = await fetchSafeMode(target);
			if (!cancelledRef.current) {
				setState(next);
			}
		} catch {
			// An unreachable node is not evidence of safe mode; stay silent rather
			// than accusing a node that simply isn't answering.
			if (!cancelledRef.current) {
				setState(null);
			}
		}
	}, [target]);

	useEffect(() => {
		cancelledRef.current = false;
		refresh();
		const id = setInterval(refresh, POLL_INTERVAL_MS);
		return () => {
			cancelledRef.current = true;
			clearInterval(id);
		};
	}, [refresh]);

	const handleLeave = useCallback(async () => {
		setLeaving(true);
		try {
			await applySafeMode(target, false);
			await restartRyuCore().catch(() => undefined);
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Couldn't leave Safe Mode");
		} finally {
			if (!cancelledRef.current) {
				setLeaving(false);
			}
		}
	}, [refresh, target]);

	if (!state?.enabled) {
		return null;
	}

	const { mcpServers, plugins, skills } = state.suppressed;

	return (
		<div className="pointer-events-auto fixed top-12 right-4 z-50 flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/15 px-3 py-2 shadow-lg backdrop-blur-xl">
			<HugeiconsIcon
				className="size-4 shrink-0 text-warning dark:text-warning"
				icon={Alert01Icon}
			/>
			<div className="flex flex-col leading-tight">
				<span className="font-medium text-xs">Safe Mode</span>
				<span className="text-[11px] text-muted-foreground">
					{plugins} app{plugins === 1 ? "" : "s"}, {skills} skill
					{skills === 1 ? "" : "s"} and {mcpServers} MCP server
					{mcpServers === 1 ? "" : "s"} aren't loaded
				</span>
			</div>
			{/* An env-forced node can only be cleared by unsetting the variable, so
			    offer the button only where it can actually work. */}
			{state.userClearable ? (
				<Button
					className="h-7"
					disabled={leaving}
					onClick={handleLeave}
					size="sm"
					variant="ghost"
				>
					Leave
				</Button>
			) : null}
		</div>
	);
}
