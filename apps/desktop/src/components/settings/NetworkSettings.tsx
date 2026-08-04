// apps/desktop/src/components/settings/NetworkSettings.tsx
//
// The node's network surface (Gateway settings → Network): the opt-in
// Tailscale/Headscale mesh plane. Owns the enable toggle, a live status line,
// and the self-hosted Headscale control-server URL (`mesh-login-server`).
//
// The mesh is PATH-adopted — it runs the official `tailscale` + `tailscaled`
// client (userspace networking, no admin rights), which must be installed on
// this machine. Enabling writes the `mesh-enabled` pref through
// `POST /api/mesh/config`; Core then starts the daemon, so this is the writer
// the rest of the mesh surface (the node dropdown's `MeshSection`, status tones)
// keys off.

import { Button } from "@ryu/ui/components/button";
import { Input } from "@ryu/ui/components/input";
import { Switch } from "@ryu/ui/components/switch";
import { useEffect, useState } from "react";
import { sileo } from "sileo";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	fetchMeshStatus,
	type MeshStatus,
	setMeshEnabled,
} from "@/src/lib/api/mesh.ts";
import { getPreference, setPreference } from "@/src/lib/api/preferences.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import {
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

export function NetworkSettings() {
	const [meshStatus, setMeshStatus] = useState<MeshStatus | null>(null);
	// True only when `/api/mesh/status` answered at all (a 404 on an older Core
	// without the plane hides the whole section).
	const [meshAvailable, setMeshAvailable] = useState(false);
	const [savingMesh, setSavingMesh] = useState(false);
	// Headscale: self-hosted Tailscale control server URL.
	const [headscaleUrl, setHeadscaleUrlValue] = useState("");
	const [headscaleLoaded, setHeadscaleLoaded] = useState(false);
	const [savingHeadscale, setSavingHeadscale] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const target = toTarget(useNodeStore.getState().getActiveNode());
		getPreference(target, "mesh-login-server").then((val) => {
			if (!cancelled) {
				setHeadscaleUrlValue(val ?? "");
				setHeadscaleLoaded(true);
			}
		});
		// `GET /api/mesh/status` answers HTTP 200 with `enabled:false` on a
		// mesh-off node (the normal case — the toggle below is the writer) and
		// 404s on a Core without the plane; only the 404 case hides the section.
		fetchMeshStatus(target)
			.then((status) => {
				if (!cancelled) {
					setMeshStatus(status);
					setMeshAvailable(true);
				}
			})
			.catch(() => {
				// No mesh plane on this node — leave the section hidden.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Enable/disable the mesh plane. Core persists the `mesh-enabled` pref,
	// flips its in-process signal, and starts/stops the Tailscale daemon
	// (PATH-adopted — the official `tailscale` client must be on this machine).
	// A daemon-start failure resolves (not rejects) with `startError`, because the
	// mesh is still enabled — the toggle reflects the persisted state and the
	// warning explains why it isn't connected.
	const handleToggleMesh = async (enabled: boolean) => {
		setSavingMesh(true);
		const target = toTarget(useNodeStore.getState().getActiveNode());
		try {
			const { startError, status } = await setMeshEnabled(target, enabled);
			setMeshStatus(status);
			if (enabled && startError) {
				sileo.warning({
					title: "Mesh enabled, but the daemon didn't start",
					description: startError,
				});
				return;
			}
			sileo.success({
				title: enabled ? "Mesh enabled" : "Mesh disabled",
				description: enabled
					? status.reachable
						? "This node is now on the tailnet."
						: "The mesh daemon is starting — it may need to finish connecting."
					: "This node has left the tailnet.",
			});
		} catch (e) {
			// A genuine rejection — Core could not persist the change.
			sileo.error({
				title: enabled
					? "Failed to enable the mesh"
					: "Failed to disable the mesh",
				description:
					e instanceof Error ? e.message : "Failed to update the mesh",
			});
		} finally {
			setSavingMesh(false);
		}
	};

	// Save the Headscale control-server URL. Core reads `mesh-login-server` raw
	// (`prefs.get(key)` → `Option<String>` handed to `tailscale up --login-server`
	// during one-shot enrollment), so the bare string is written — no JSON wrapping.
	const handleSaveHeadscale = async () => {
		setSavingHeadscale(true);
		const target = toTarget(useNodeStore.getState().getActiveNode());
		const ok = await setPreference(target, "mesh-login-server", headscaleUrl);
		setSavingHeadscale(false);
		if (ok) {
			sileo.success({
				title: "Headscale server saved",
				description:
					"Restart the mesh daemon (or this node) for the change to take effect.",
			});
		} else {
			sileo.error({ title: "Failed to save Headscale server URL" });
		}
	};

	// The section is hidden only when the running Core has no mesh plane at all
	// (`meshAvailable` false — an older binary). A mesh-off install still gets the
	// enable toggle; turning it on is the whole point of this tab.
	if (!meshAvailable) {
		return null;
	}

	return (
		<SettingsSection
			caption="Join this node to a Tailscale tailnet so it can reach — and be reached by — other Ryu nodes. Uses the official tailscale + tailscaled client in userspace networking mode (no admin rights), which must be installed on this machine."
			title="Mesh (Tailscale / Headscale)"
		>
			<SettingsGroup>
				<SettingsItem
					actions={
						<Switch
							checked={meshStatus?.enabled ?? false}
							disabled={savingMesh}
							id="mesh-enabled"
							onCheckedChange={handleToggleMesh}
						/>
					}
					description="When on, this node joins the tailnet and other Ryu nodes can reach it. Turning it off leaves the tailnet."
					title="Enable mesh"
				/>
				{meshStatus?.enabled ? (
					<SettingsItem
						description={
							meshStatus.reachable
								? meshStatus.magicDnsName
									? `Reachable on the tailnet as ${meshStatus.magicDnsName}.`
									: "Reachable on the tailnet."
								: "Enabled but not connected yet — the daemon may still be starting, or the official Tailscale client is missing or not logged in."
						}
						title="Status"
					/>
				) : null}
				<SettingsItem title="Control server URL">
					<div className="flex items-center gap-2">
						<Input
							autoComplete="off"
							className="h-8 flex-1 text-xs"
							disabled={!headscaleLoaded}
							id="headscale-url"
							onChange={(e) => setHeadscaleUrlValue(e.target.value)}
							placeholder="https://headscale.example.com"
							type="url"
							value={headscaleUrl}
						/>
						<Button
							disabled={!headscaleLoaded || savingHeadscale}
							onClick={handleSaveHeadscale}
							size="sm"
						>
							{savingHeadscale ? "Saving…" : "Save"}
						</Button>
					</div>
					<p className="text-muted-foreground text-xs">
						Point the mesh at a self-hosted Headscale server instead of
						Tailscale SaaS. Leave empty to use Tailscale SaaS. Passed as{" "}
						<code>--login-server</code> to <code>tailscale up</code>. It applies
						the next time this node enrolls.
					</p>
				</SettingsItem>
			</SettingsGroup>
		</SettingsSection>
	);
}
