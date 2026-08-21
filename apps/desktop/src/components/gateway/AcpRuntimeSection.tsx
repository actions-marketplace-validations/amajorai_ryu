import { Badge } from "@ryu/ui/components/badge.tsx";
import { Input } from "@ryu/ui/components/input.tsx";
import { Label } from "@ryu/ui/components/label.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import { Switch } from "@ryu/ui/components/switch.tsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { sileo } from "sileo";
import {
	SettingsCard,
	SettingsSection,
} from "@/src/components/settings/shared/settings-items.tsx";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	DEFAULT_GATEWAY_ACP,
	fetchGatewayConfig,
	type GatewayAcpConfig,
	type GatewayAcpSettings,
	type GatewayConfig,
	updateGatewayConfig,
} from "@/src/lib/api/gateway.ts";

const MIN_IDLE_MINUTES = 1;
const MAX_IDLE_MINUTES = 24 * 60;
const PARALLEL_OPTIONS = [1, 2, 4, 8, 16, 32];

function acpSettings(config: GatewayAcpConfig): GatewayAcpSettings {
	return {
		idle_timeout_minutes: config.idle_timeout_minutes,
		max_parallel_agents: config.max_parallel_agents,
		keep_computer_awake: config.keep_computer_awake,
	};
}

function formatRam(bytes: number | undefined): string {
	if (!bytes || bytes < 1) {
		return "RAM unavailable";
	}
	const gib = bytes / 1024 ** 3;
	return `${gib >= 10 ? gib.toFixed(0) : gib.toFixed(1)} GiB RAM`;
}

function runtimeConfig(config: GatewayConfig | undefined): GatewayAcpConfig {
	return config?.acp ?? DEFAULT_GATEWAY_ACP;
}

/** Gateway-level controls for the resident ACP process pool. */
export function AcpRuntimeSection({
	canConfigure,
	target,
}: {
	canConfigure: boolean;
	target: ApiTarget;
}) {
	const queryClient = useQueryClient();
	const configQuery = useQuery({
		queryKey: ["gateway-acp-runtime", target.url],
		queryFn: () => fetchGatewayConfig(target),
		refetchOnWindowFocus: false,
	});
	const config = runtimeConfig(configQuery.data);
	const [idleDraft, setIdleDraft] = useState(
		String(config.idle_timeout_minutes)
	);

	useEffect(() => {
		setIdleDraft(String(config.idle_timeout_minutes));
	}, [config.idle_timeout_minutes]);

	const save = useMutation({
		mutationFn: (next: GatewayAcpSettings) =>
			updateGatewayConfig(target, { acp: next }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["gateway-acp-runtime", target.url],
			});
		},
		onError: (error: Error) => {
			sileo.error({
				title: "Could not save ACP runtime settings",
				description: error.message,
			});
		},
	});

	const disabled = !canConfigure || save.isPending || configQuery.isLoading;
	const commit = (patch: Partial<GatewayAcpSettings>) => {
		save.mutate({ ...acpSettings(config), ...patch });
	};
	const commitIdle = () => {
		const value = Number(idleDraft);
		if (!Number.isInteger(value)) {
			setIdleDraft(String(config.idle_timeout_minutes));
			return;
		}
		const bounded = Math.min(
			MAX_IDLE_MINUTES,
			Math.max(MIN_IDLE_MINUTES, value)
		);
		setIdleDraft(String(bounded));
		if (bounded !== config.idle_timeout_minutes) {
			commit({ idle_timeout_minutes: bounded });
		}
	};

	if (configQuery.isLoading) {
		return (
			<div data-testid="acp-runtime-settings">
				<SettingsSection
					caption="Core owns the ACP process pool; these node-level controls apply to every ACP agent."
					title="ACP agent runtime"
				>
					<SettingsCard>
						<Spinner />
					</SettingsCard>
				</SettingsSection>
			</div>
		);
	}

	const autoLimit = config.auto_max_parallel_agents;
	const effectiveLimit =
		config.effective_max_parallel_agents ??
		config.max_parallel_agents ??
		autoLimit;
	const activeAgents = config.active_agents ?? 0;

	return (
		<div data-testid="acp-runtime-settings">
			<SettingsSection
				caption="ACP sessions stay warm for faster replies, but old inactive threads are reaped and new processes wait behind a node-wide limit so they cannot accumulate without bound."
				title="ACP agent runtime"
			>
				<div className="space-y-2">
					<SettingsCard>
						<div className="flex items-start justify-between gap-4">
							<div className="min-w-0 space-y-1">
								<Label htmlFor="acp-idle-timeout">
									{"Stop idle ACP sessions after"}
								</Label>
								<p className="text-muted-foreground text-xs">
									An inactive session is killed after this many minutes to
									release its memory. The next message starts a new ACP process
									and may take longer.
								</p>
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<Input
									aria-label="ACP idle timeout in minutes"
									className="w-20 text-right tabular-nums"
									disabled={disabled}
									id="acp-idle-timeout"
									inputMode="numeric"
									max={MAX_IDLE_MINUTES}
									min={MIN_IDLE_MINUTES}
									onBlur={commitIdle}
									onChange={(event) => setIdleDraft(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.currentTarget.blur();
										}
									}}
									type="number"
									value={idleDraft}
								/>
								<span className="text-muted-foreground text-sm">min</span>
							</div>
						</div>
					</SettingsCard>

					<SettingsCard>
						<div className="flex items-start justify-between gap-4">
							<div className="min-w-0 space-y-1">
								<Label htmlFor="acp-max-parallel">
									{"Maximum parallel ACP agents"}
								</Label>
								<p className="text-muted-foreground text-xs">
									Auto uses a conservative CPU/RAM estimate for this node. New
									agents wait instead of spawning when the limit is full.
								</p>
							</div>
							<Select
								disabled={disabled}
								onValueChange={(value) =>
									commit({
										max_parallel_agents:
											value === "auto" ? null : Number(value),
									})
								}
								value={
									config.max_parallel_agents === null
										? "auto"
										: String(config.max_parallel_agents)
								}
							>
								<SelectTrigger
									aria-label="Maximum parallel ACP agents"
									className="w-32"
									id="acp-max-parallel"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">
										Auto{autoLimit ? ` (${autoLimit})` : ""}
									</SelectItem>
									{PARALLEL_OPTIONS.map((value) => (
										<SelectItem key={value} value={String(value)}>
											{value}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
							<Badge variant="secondary">
								{activeAgents} active / {effectiveLimit ?? "—"} allowed
							</Badge>
							{config.hardware ? (
								<span className="text-muted-foreground">
									{config.hardware.physical_cores} physical{" · "}
									{formatRam(config.hardware.total_ram_bytes)}
								</span>
							) : null}
						</div>
					</SettingsCard>

					<SettingsCard>
						<div className="flex items-center justify-between gap-3">
							<div className="space-y-1">
								<Label htmlFor="acp-keep-awake">
									{"Keep this computer awake while agents run"}
								</Label>
								<p className="text-muted-foreground text-xs">
									Uses the native OS sleep-inhibition API only while a local ACP
									agent is active. The display may still turn off.
								</p>
							</div>
							<Switch
								aria-label="Keep this computer awake while ACP agents run"
								checked={config.keep_computer_awake}
								disabled={disabled}
								id="acp-keep-awake"
								onCheckedChange={(keep_computer_awake) =>
									commit({ keep_computer_awake })
								}
							/>
						</div>
					</SettingsCard>
				</div>
			</SettingsSection>
		</div>
	);
}
