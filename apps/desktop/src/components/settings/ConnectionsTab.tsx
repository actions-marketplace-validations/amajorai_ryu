import {
	GoogleIcon,
	Link01Icon,
	Unlink01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@ryu/ui/components/alert-dialog";
import { Badge } from "@ryu/ui/components/badge";
import { Button } from "@ryu/ui/components/button";
import { Spinner } from "@ryu/ui/components/spinner";
import { Switch } from "@ryu/ui/components/switch";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { sileo } from "sileo";
import { WEB_URL } from "@/lib/app-urls.ts";
import { authClient } from "@/lib/auth-client.ts";
import { openExternal } from "@/lib/tauri-bridge.ts";
import { ConnectDeviceQR } from "@/src/components/devices/ConnectDeviceQR.tsx";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import {
	type ApiTarget,
	currentClientId,
	toTarget,
} from "@/src/lib/api/client.ts";
import {
	type ConnectedClient,
	fetchConnections,
} from "@/src/lib/api/connections.ts";
import {
	getNodeAuthState,
	type NodeAuthState,
} from "@/src/lib/api/node-auth.ts";
import {
	DEFAULT_CLOUD_SYNC,
	getCloudSyncEnabled,
	setCloudSyncEnabled,
} from "@/src/lib/api/preferences.ts";
import {
	connectionDisplayName,
	connectionSurfaceMeta,
} from "@/src/lib/connection-surface.ts";
import {
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

/**
 * The cross-device sync switch (M10). Writes Core's `cloud-sync-enabled` pref on
 * the ACTIVE node; Core's sync loop re-reads it every tick, so a flip takes effect
 * without a restart (`apps/core/src/server/sync.rs`).
 *
 * Two truths the copy must not paper over:
 *  - the loop also needs the NODE to be signed in (it no-ops as `Unauthenticated`
 *    otherwise), so we read the node's own auth status — not this window's session;
 *  - `RYU_SYNC_ENABLED` in the node's environment overrides the pref, so OFF here
 *    does not prove sync is off on a node that sets it.
 */
function CloudSyncSection() {
	const activeNode = useActiveNode();
	// Depend on the PRIMITIVES, not the node object: `getActiveNode` rebuilds its
	// result whenever the node list is re-decorated, and a fresh object each render
	// would refire the load effect — which opens with `setLoaded(false)`, so the
	// switch would flicker disabled and refetch on every render. Same reasoning as
	// PrivacySettings.
	const target: ApiTarget = useMemo(
		() => toTarget(activeNode),
		[activeNode.url, activeNode.token]
	);

	const [enabled, setEnabled] = useState(DEFAULT_CLOUD_SYNC);
	const [nodeAuth, setNodeAuth] = useState<NodeAuthState>(null);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setLoaded(false);
		Promise.all([getCloudSyncEnabled(target), getNodeAuthState(target)]).then(
			([syncOn, auth]) => {
				if (cancelled) {
					return;
				}
				setEnabled(syncOn);
				setNodeAuth(auth);
				setLoaded(true);
			}
		);
		return () => {
			cancelled = true;
		};
	}, [target]);

	const handleToggle = useCallback(
		async (next: boolean) => {
			setEnabled(next); // optimistic
			const ok = await setCloudSyncEnabled(target, next);
			if (!ok) {
				// The write never landed — revert so the switch never shows a choice
				// that wasn't saved.
				setEnabled(!next);
				sileo.error({
					title: "Couldn't save your sync choice",
					description: "Check your connection to this node and try again.",
				});
			}
		},
		[target]
	);

	// Fail OPEN on an unreadable status: only a node we KNOW is signed out blocks
	// the switch, so an unreachable/older Core never locks the control.
	const signedOut = nodeAuth === "signed-out";
	const description = signedOut
		? "Sign in on this node to sync across devices. Until then, syncing stays paused even when this is on."
		: "Off by default. When on, this node mirrors your chats and editable Spaces documents to your Ryu account so your other devices can pick them up. Binary file attachments stay local. Takes effect within a minute, with no restart.";

	return (
		<SettingsSection
			caption="Keep chats and Spaces documents in step across the devices signed in to your account. Everything stays on this device until you turn this on."
			title="Cross-device sync"
		>
			<SettingsGroup>
				<SettingsItem
					actions={
						<Switch
							aria-label="Sync my chats and Spaces across devices"
							checked={enabled}
							disabled={!loaded || signedOut}
							id="cloud-sync-enabled"
							onCheckedChange={handleToggle}
						/>
					}
					description={description}
					title="Sync my chats and Spaces across devices"
				/>
			</SettingsGroup>
		</SettingsSection>
	);
}

function relativeLastSeen(lastSeen: number): string {
	const seconds = Math.max(0, Math.floor(Date.now() / 1000) - lastSeen);
	if (seconds < 10) {
		return "Active now";
	}
	if (seconds < 60) {
		return `Active ${seconds}s ago`;
	}
	return `Active ${Math.floor(seconds / 60)}m ago`;
}

function ConnectedDeviceRow({
	client,
	self,
}: {
	client: ConnectedClient;
	self: boolean;
}) {
	const surface = connectionSurfaceMeta(client.surface);
	return (
		<SettingsItem
			actions={self ? <Badge variant="secondary">This device</Badge> : null}
			description={
				<span className="flex items-center gap-1.5">
					<span>{surface.label}</span>
					<span aria-hidden>·</span>
					<span>{relativeLastSeen(client.lastSeen)}</span>
				</span>
			}
			key={client.clientId}
			title={
				<span className="flex min-w-0 items-center gap-3">
					<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background">
						<HugeiconsIcon className="size-4" icon={surface.icon} />
					</span>
					<span className="min-w-0 flex-1">
						<span className="block truncate">
							{connectionDisplayName(client)}
						</span>
						<span className="mt-0.5 block truncate text-muted-foreground text-xs">
							{surface.label} · {relativeLastSeen(client.lastSeen)}
						</span>
					</span>
				</span>
			}
		/>
	);
}

export function ConnectedDevicesSection() {
	const activeNode = useActiveNode();
	const target: ApiTarget = useMemo(
		() => toTarget(activeNode),
		[activeNode.url, activeNode.token]
	);
	const query = useQuery({
		queryKey: ["node-connections-settings", target.url, target.token],
		queryFn: ({ signal }) => fetchConnections(target, signal),
		enabled: Boolean(target.url),
		refetchInterval: 15_000,
		retry: false,
	});
	const selfClientId = currentClientId();

	return (
		<SettingsSection
			caption="Presence is a short-lived view of clients that recently talked to this node. It identifies the calling surface, not who is authorized to access data."
			title="Connected devices"
		>
			{query.isLoading ? (
				<div className="flex items-center gap-2 px-3 text-muted-foreground text-sm">
					<Spinner className="size-4" />
					Checking connected devices…
				</div>
			) : null}
			{query.error ? (
				<p className="px-3 text-muted-foreground text-sm">
					Connected-device presence is unavailable on this node.
				</p>
			) : null}
			{query.data && query.data.clients.length === 0 ? (
				<p className="px-3 text-muted-foreground text-sm">
					No other devices have connected recently.
				</p>
			) : null}
			{query.data && query.data.clients.length > 0 ? (
				<SettingsGroup>
					{query.data.clients.map((client) => (
						<ConnectedDeviceRow
							client={client}
							key={client.clientId}
							self={client.clientId === selfClientId}
						/>
					))}
				</SettingsGroup>
			) : null}
		</SettingsSection>
	);
}

interface AccountInfo {
	accountId: string;
	createdAt: Date;
	id: string;
	providerId: string;
}

export function ConnectionsTab() {
	const queryClient = useQueryClient();
	const [isLinking, setIsLinking] = useState(false);
	const [isUnlinking, setIsUnlinking] = useState(false);

	const { data: accounts, isLoading } = useQuery({
		queryKey: ["linked-accounts"],
		queryFn: async () => {
			const result = await authClient.listAccounts();
			if (result.error) {
				throw new Error(result.error.message);
			}
			return (result.data as unknown as AccountInfo[] | null) ?? [];
		},
	});

	const googleAccount = accounts?.find((a) => a.providerId === "google");

	const handleLinkGoogle = async () => {
		setIsLinking(true);
		try {
			const callbackUrl = `${WEB_URL}/profile?tab=linked-accounts`;
			const result = await authClient.linkSocial({
				provider: "google",
				callbackURL: callbackUrl,
			});
			if (result.error) {
				throw new Error(result.error.message);
			}
			// Open in browser for OAuth flow
			const url = (result.data as { url?: string } | null)?.url;
			if (url) {
				await openExternal(url);
				sileo.success({ title: "Complete Google sign-in in your browser" });
			} else {
				sileo.error({
					title: "Couldn't start Google sign-in",
					description: "Please try again in a moment.",
				});
			}
		} catch (error) {
			sileo.error({
				title:
					error instanceof Error
						? error.message
						: "Failed to link Google account",
			});
		} finally {
			setIsLinking(false);
		}
	};

	const handleUnlinkGoogle = async () => {
		if (!googleAccount) {
			return;
		}
		setIsUnlinking(true);
		try {
			const result = await authClient.unlinkAccount({
				accountId: googleAccount.accountId,
			});
			if (result.error) {
				throw new Error(result.error.message);
			}
			sileo.success({ title: "Google account unlinked" });
			queryClient.invalidateQueries({ queryKey: ["linked-accounts"] });
		} catch (error) {
			sileo.error({
				title:
					error instanceof Error
						? error.message
						: "Failed to unlink Google account",
			});
		} finally {
			setIsUnlinking(false);
		}
	};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-8">
				<Spinner className="size-5" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<ConnectedDevicesSection />
			<SettingsSection
				caption="Connect third-party accounts to sign in faster."
				title="Linked accounts"
			>
				<SettingsGroup>
					<SettingsItem
						actions={
							googleAccount ? (
								<AlertDialog>
									<AlertDialogTrigger
										render={
											<Button
												disabled={isUnlinking}
												size="sm"
												variant="ghost"
											/>
										}
									>
										<HugeiconsIcon
											className="mr-2 size-4"
											icon={Unlink01Icon}
										/>
										Unlink
									</AlertDialogTrigger>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>
												Unlink Google Account?
											</AlertDialogTitle>
											<AlertDialogDescription>
												You won't be able to sign in with Google anymore. Make
												sure you have another sign-in method (password or magic
												link) before unlinking.
											</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel>Cancel</AlertDialogCancel>
											<AlertDialogAction
												disabled={isUnlinking}
												onClick={handleUnlinkGoogle}
											>
												{isUnlinking ? "Unlinking…" : "Unlink"}
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							) : (
								<Button
									disabled={isLinking}
									onClick={handleLinkGoogle}
									size="sm"
									variant="ghost"
								>
									<HugeiconsIcon className="mr-2 size-4" icon={Link01Icon} />
									{isLinking ? "Opening browser…" : "Link"}
								</Button>
							)
						}
						description={googleAccount ? "Connected" : "Not connected"}
						title={
							<span className="flex items-center gap-3">
								<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background">
									<HugeiconsIcon className="size-4" icon={GoogleIcon} />
								</span>
								Google
							</span>
						}
					/>
				</SettingsGroup>
			</SettingsSection>
			<SettingsSection
				caption="Scan the QR code with the Ryu mobile app to connect your phone to this device."
				title="Connect a phone"
			>
				<SettingsGroup>
					<div className="px-4 py-4">
						<ConnectDeviceQR />
					</div>
				</SettingsGroup>
			</SettingsSection>
			<CloudSyncSection />
		</div>
	);
}
