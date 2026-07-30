// Encryption settings tab (Gateway dialog → Node → Encryption): what this node
// encrypts at rest, and where the key that does it is held.
//
// Read-only by design. All crypto lives in Core (`ryu_crypto` + the per-store
// seal/open call sites) and this tab renders `GET /api/encryption/status`
// verbatim: it never sees key material, and it offers no rotate/re-encrypt
// actions (those are later slices of `docs/encryption-at-rest.md`).
//
// The point of the tab is honesty about a MIXED posture. Encryption landed in
// slices — chats, memory, the identity vault and plugin secrets are sealed;
// preferences, the device token and Spaces documents are not yet — so a single
// "Encrypted ✓" badge would misreport the node. Every store gets its own row,
// and the file-fallback key (key stored next to the data it protects) is called
// out as the degraded custody it is.

import { Badge } from "@ryu/ui/components/badge";
import { Button } from "@ryu/ui/components/button";
import { useCallback, useEffect, useState } from "react";
import {
	SettingsCard,
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "@/src/components/settings/shared/settings-items.tsx";
import { useActiveNodeGetter } from "@/src/hooks/useActiveNode.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	type EncryptionStatus,
	fetchEncryptionStatus,
	type KeyCustody,
	type StoreCoverage,
} from "@/src/lib/api/encryption.ts";

/** Human copy for each custody path, worst case spelled out. */
const KEY_SOURCE_COPY: Record<
	string,
	{ caption: string; label: string; strong: boolean }
> = {
	env: {
		label: "Environment variable",
		caption:
			"The key is injected by whoever starts this node and is never written to disk by Ryu. Keep a safe backup of it — without it, encrypted data cannot be read again.",
		strong: true,
	},
	keychain: {
		label: "System keychain",
		caption:
			"The key lives in your operating system's keychain, outside the data folder, so a copy of the data folder alone cannot decrypt anything.",
		strong: true,
	},
	file: {
		label: "Key file in the data folder",
		caption:
			"No keychain was reachable, so the key was written to a file that sits next to the data it protects. Anyone who copies the data folder gets both. Set RYU_MASTER_KEY, or run where a system keychain is available, to restore the full guarantee.",
		strong: false,
	},
};

const STORE_BADGE: Record<
	StoreCoverage["status"],
	{ text: string; variant: "default" | "destructive" | "secondary" }
> = {
	sealed: { text: "Encrypted", variant: "default" },
	partial: { text: "Partly encrypted", variant: "secondary" },
	plaintext: { text: "Not encrypted", variant: "destructive" },
};

/** "412 of 480 rows" — only when Core could actually measure the store. */
function coverageLine(store: StoreCoverage): string | null {
	if (store.total === null || store.total === 0) {
		return null;
	}
	if (store.sealed === null) {
		return null;
	}
	if (store.sealed === store.total) {
		return `All ${store.total.toLocaleString()} stored items encrypted`;
	}
	return `${store.sealed.toLocaleString()} of ${store.total.toLocaleString()} stored items encrypted`;
}

function KeySection({ custody }: { custody: KeyCustody }) {
	if (!custody.available) {
		return (
			<SettingsSection
				caption="Until the key loads, the encrypted stores refuse to open rather than falling back to writing your data in the clear."
				title="Encryption key"
			>
				<SettingsCard className="flex flex-col gap-2">
					<div className="font-medium text-destructive text-sm">
						This node cannot load its encryption key
					</div>
					<div className="text-muted-foreground text-xs">
						{custody.error ?? "The master key could not be resolved."}
					</div>
				</SettingsCard>
			</SettingsSection>
		);
	}

	const copy = custody.source ? KEY_SOURCE_COPY[custody.source] : undefined;

	return (
		<SettingsSection
			caption={
				copy?.caption ??
				"Where the key that encrypts this node's data is kept. It is never shown here, and never leaves this device."
			}
			title="Encryption key"
		>
			<SettingsGroup>
				<SettingsItem
					actions={
						<Badge variant={copy?.strong ? "default" : "destructive"}>
							{copy?.strong
								? "Held outside your data"
								: "Stored with your data"}
						</Badge>
					}
					title={copy?.label ?? "Unknown source"}
				/>
				{custody.source === "keychain" && custody.keychainAccount ? (
					<SettingsItem
						actions={
							<span className="font-mono text-muted-foreground text-xs">
								{custody.keychainService}/{custody.keychainAccount}
							</span>
						}
						title="Keychain entry"
					/>
				) : null}
				{custody.source === "env" ? (
					<SettingsItem
						actions={
							<span className="font-mono text-muted-foreground text-xs">
								{custody.envVar}
							</span>
						}
						title="Provided by"
					/>
				) : null}
				{custody.keyFile ? (
					<SettingsItem
						actions={
							<span className="max-w-[22rem] truncate font-mono text-muted-foreground text-xs">
								{custody.keyFile}
							</span>
						}
						title="Key file"
					/>
				) : null}
				{custody.legacyMemoryKeyPresent ? (
					<SettingsItem
						actions={<Badge variant="secondary">Superseded</Badge>}
						title="Older memory.key still in the data folder"
					/>
				) : null}
			</SettingsGroup>
		</SettingsSection>
	);
}

export function EncryptionSettings() {
	const getNode = useActiveNodeGetter();
	const [status, setStatus] = useState<EncryptionStatus | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);

	const refresh = useCallback(() => {
		setLoadFailed(false);
		fetchEncryptionStatus(toTarget(getNode()))
			.then((next) => {
				setStatus(next);
				setLoadFailed(false);
			})
			.catch(() => {
				setStatus(null);
				setLoadFailed(true);
			});
	}, [getNode]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	if (loadFailed) {
		return (
			<SettingsSection
				caption="Encryption state is read from this node, so it needs a reachable Core."
				title="Encryption"
			>
				<SettingsCard className="flex flex-col items-start gap-3">
					<p className="text-muted-foreground text-sm">
						We couldn't read this node's encryption state.
					</p>
					<Button onClick={() => refresh()} size="sm" variant="outline">
						Retry
					</Button>
				</SettingsCard>
			</SettingsSection>
		);
	}

	if (!status) {
		return (
			<SettingsSection title="Encryption">
				<SettingsCard>
					<span className="text-muted-foreground text-sm">Loading…</span>
				</SettingsCard>
			</SettingsSection>
		);
	}

	const exposed = status.stores.filter((s) => s.status !== "sealed");

	return (
		<div className="flex flex-col gap-6">
			<KeySection custody={status.key} />

			<SettingsSection
				caption={
					exposed.length === 0
						? "Everything below is encrypted on this device. Timestamps, ids and roles stay readable so lists, search and ordering keep working."
						: `${exposed.length} of ${status.stores.length} areas are still stored without encryption. Timestamps, ids and roles are always left readable so lists, search and ordering keep working.`
				}
				headerAction={
					<Button onClick={() => refresh()} size="sm" variant="ghost">
						Refresh
					</Button>
				}
				title="What's encrypted on this device"
			>
				<SettingsGroup>
					{status.stores.map((store) => {
						const badge = STORE_BADGE[store.status];
						const coverage = coverageLine(store);
						return (
							<SettingsItem
								actions={<Badge variant={badge.variant}>{badge.text}</Badge>}
								key={store.id}
								title={store.label}
							>
								<div className="flex flex-col gap-0.5 text-muted-foreground text-xs">
									<span>{store.detail}</span>
									{coverage ? <span>{coverage}</span> : null}
								</div>
							</SettingsItem>
						);
					})}
				</SettingsGroup>
			</SettingsSection>

			<SettingsSection
				caption="Encrypted data is only as recoverable as its key. If the key is lost — a wiped keychain, a re-imaged machine, a missing environment variable — the encrypted chats and memories on this node cannot be recovered by anyone, including us."
				title="Data folder"
			>
				<SettingsGroup>
					<SettingsItem
						actions={
							<span className="max-w-[22rem] truncate font-mono text-muted-foreground text-xs">
								{status.dataDir}
							</span>
						}
						title="Location"
					/>
				</SettingsGroup>
			</SettingsSection>
		</div>
	);
}
