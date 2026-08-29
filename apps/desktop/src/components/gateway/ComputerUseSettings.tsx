import { SquareLock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@ryu/ui/components/badge.tsx";
import { Switch } from "@ryu/ui/components/switch.tsx";
import { useEffect, useMemo, useState } from "react";
import {
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "@/src/components/settings/shared/settings-items.tsx";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	fetchGatewayConfig,
	type GatewayComputerUseConfig,
	updateGatewayConfig,
} from "@/src/lib/api/gateway.ts";

/** Gateway-owned policy controls for Ghost's use of one selected device. */
export function ComputerUseSettings({
	canConfigure,
	reachable,
	target,
}: {
	canConfigure: boolean;
	reachable: boolean;
	target: ApiTarget;
}) {
	const [config, setConfig] = useState<GatewayComputerUseConfig | null>(null);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const stableTarget = useMemo(
		() => ({ url: target.url, token: target.token, userJwt: target.userJwt }),
		[target.token, target.url, target.userJwt]
	);

	useEffect(() => {
		if (!reachable) {
			setConfig(null);
			setLoading(false);
			return;
		}

		let cancelled = false;
		setLoading(true);
		setError(null);
		setSaved(false);
		fetchGatewayConfig(stableTarget)
			.then((next) => {
				if (!cancelled) {
					setConfig(next.computer_use);
				}
			})
			.catch((cause: unknown) => {
				if (!cancelled) {
					setError(
						cause instanceof Error
							? cause.message
							: "Could not load device settings"
					);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [reachable, stableTarget]);

	const handleLockedUseChange = async (lockedUse: boolean) => {
		if (!(config && reachable && canConfigure) || saving) {
			return;
		}

		const previous = config;
		const next = { ...config, locked_use: lockedUse };
		setConfig(next);
		setSaving(true);
		setError(null);
		setSaved(false);
		try {
			await updateGatewayConfig(target, { computer_use: next });
			setSaved(true);
		} catch (cause: unknown) {
			setConfig(previous);
			setError(
				cause instanceof Error
					? cause.message
					: "Could not save device settings"
			);
		} finally {
			setSaving(false);
		}
	};

	const lockedUse = config?.locked_use ?? false;

	return (
		<SettingsSection
			caption="These permissions belong to the selected device. The Gateway stores the policy; Ghost still has to pass the operating system's safety and permission checks."
			title="Device control"
		>
			<SettingsGroup>
				<SettingsItem
					actions={
						<div className="flex items-center gap-2">
							<Badge variant={lockedUse ? "default" : "secondary"}>
								{lockedUse ? "Allowed" : "Off"}
							</Badge>
							<Switch
								aria-label="Allow locked use"
								checked={lockedUse}
								disabled={
									loading ||
									saving ||
									!reachable ||
									!canConfigure ||
									config === null
								}
								onCheckedChange={handleLockedUseChange}
							/>
						</div>
					}
					description="Allow Ghost to request a locked-session path on this device. Turning this on does not unlock the device or bypass local safety controls."
					title={
						<span className="flex items-center gap-2">
							<HugeiconsIcon
								className="size-4 text-muted-foreground"
								icon={SquareLock01Icon}
							/>
							Allow locked use
						</span>
					}
				/>
			</SettingsGroup>
			{loading ? (
				<p className="px-3 text-muted-foreground text-sm">
					Loading device settings…
				</p>
			) : null}
			{reachable ? null : (
				<p className="px-3 text-muted-foreground text-sm">
					Device settings are unavailable while this device is offline.
				</p>
			)}
			{error ? <p className="px-3 text-destructive text-sm">{error}</p> : null}
			{canConfigure ? null : (
				<p className="px-3 text-muted-foreground text-sm">
					You can view this policy, but you need device configuration access to
					change it.
				</p>
			)}
			{saved ? <p className="px-3 text-sm text-success">Saved.</p> : null}
		</SettingsSection>
	);
}
