// apps/desktop/src/components/downloads/DownloadConcurrencyControl.tsx
//
// "How many at once" for the download center — a node-scoped Core setting
// (GET/PUT /api/downloads/settings), surfaced right where the queue is visible
// rather than buried in a settings tab, because "why is this taking so long" and
// "can it go faster" are the same moment.
//
// Auto is the default and is not a euphemism for a fixed number: Core hill-climbs
// the slot count against measured throughput (see the `autotune` module), so the
// row reports what it currently resolves to and the speed it reasoned from. The
// manual option exists for the two cases the tuner cannot see — a metered or
// shared connection the user wants to keep headroom on, and a server that starts
// refusing parallel connections.

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import {
	type ConcurrencyMode,
	type DownloadSettings,
	getDownloadSettings,
	setDownloadSettings,
} from "@/src/lib/api/downloads.ts";
import { formatBytes } from "./DownloadRow.tsx";

const AUTO_VALUE = "auto";

/** Describe what the current setting resolves to, in plain terms. */
function describe(settings: DownloadSettings): string {
	const at = `${settings.effective_slots} at a time`;
	if (settings.mode === "manual") {
		return at;
	}
	if (settings.measured_bps > 0) {
		return `${at} · tuned for ${formatBytes(settings.measured_bps)}/s`;
	}
	return `${at} · measuring your connection`;
}

export function DownloadConcurrencyControl() {
	const node = useActiveNode();
	const target = {
		token: node.token,
		userJwt: node.userJwt ?? null,
		url: node.url,
	};
	const queryClient = useQueryClient();
	const queryKey = ["downloads", "settings", node.url];

	const { data } = useQuery({
		queryFn: () => getDownloadSettings(target),
		queryKey,
		// Auto moves the effective count while downloads run, so a static read
		// would show a stale number for the whole session.
		refetchInterval: 10_000,
	});

	const mutation = useMutation({
		mutationFn: ({ mode, slots }: { mode: ConcurrencyMode; slots?: number }) =>
			setDownloadSettings(target, mode, slots),
		onSuccess: (next) => queryClient.setQueryData(queryKey, next),
	});

	if (!data) {
		return null;
	}

	const options = [
		{ label: "Auto", value: AUTO_VALUE },
		...Array.from(
			{ length: data.max_slots - data.min_slots + 1 },
			(_, i) => data.min_slots + i
		).map((n) => ({
			label: n === 1 ? "1 at a time" : `${n} at a time`,
			value: String(n),
		})),
	];
	const value = data.mode === "auto" ? AUTO_VALUE : String(data.manual_slots);

	return (
		<div className="flex flex-col items-end gap-1">
			<Select
				disabled={data.env_locked || mutation.isPending}
				items={options}
				onValueChange={(next) =>
					mutation.mutate(
						next === AUTO_VALUE
							? { mode: "auto" }
							: { mode: "manual", slots: Number(next) }
					)
				}
				value={value}
			>
				<SelectTrigger className="h-8 w-40 text-sm">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((o) => (
						<SelectItem key={o.value} value={o.value}>
							{o.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<span className="text-[11px] text-muted-foreground">
				{data.env_locked
					? "Set by RYU_MAX_CONCURRENT_DOWNLOADS on this node"
					: describe(data)}
			</span>
		</div>
	);
}
