import { Button } from "@ryu/ui/components/button";
import { Checkbox } from "@ryu/ui/components/checkbox";
import { Input } from "@ryu/ui/components/input";
import { Label } from "@ryu/ui/components/label";
import { toast } from "@ryu/ui/components/sileo";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { type ApiTarget, request } from "@/src/lib/api/client.ts";
import { isTauriReady } from "@/src/lib/tauri-ready.ts";
import {
	canRevokePairedClient,
	describePairingConstraints,
	formatPairingTimestamp,
	getPairedClientStatus,
	narrowPairingScopes,
	type PairedClient,
	type PairingConstraints,
} from "./NodeAccessSettings.model.ts";

/**
 * Who is allowed to talk to this node.
 *
 * Core mints a node-admittance token on first boot, so the local API is
 * authenticated by default rather than open to every process on the machine.
 * Surfaces that run as their own process read that token off disk. Two classes
 * cannot — a browser page (the hosted webapp, the extension) and a desktop on
 * ANOTHER machine — so they pair with a device code that a human approves here.
 *
 * This panel is that approval surface, plus the token itself for the cases where
 * copying it by hand is the right answer (a headless node reached over SSH).
 */

type TokenSource = "env" | "file" | "none";

interface PairingRequest {
	client_name: string;
	created_at: number;
	requested_constraints?: PairingConstraints;
	requested_expires_at?: number | null;
	requested_scopes?: string[];
	user_code: string;
}

function ScopeList({
	emptyLabel,
	label,
	scopes,
}: {
	emptyLabel: string;
	label: string;
	scopes?: string[];
}) {
	return (
		<div className="mt-2">
			<p className="text-muted-foreground text-xs">{label}</p>
			{scopes && scopes.length > 0 ? (
				<ul aria-label={label} className="mt-1 flex flex-wrap gap-1">
					{scopes.map((scope) => (
						<li
							className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]"
							key={scope}
						>
							{scope}
						</li>
					))}
				</ul>
			) : (
				<p className="mt-1 text-muted-foreground text-xs">{emptyLabel}</p>
			)}
		</div>
	);
}

/** Poll interval for pending requests, in ms. Short: a human is waiting. */
const PENDING_POLL_MS = 3000;

/**
 * Whether this build is running inside Tauri (the desktop shell) rather than a
 * plain browser tab. The webapp ships the SAME UI through Tauri API shims, so the
 * distinction cannot come from the bundle — only from the host.
 *
 * It decides which half of this panel is useful: a desktop reads the node token
 * off local disk and APPROVES other devices; a browser tab can do neither, so it
 * pairs and gets approved instead.
 */
function isTauri(): boolean {
	return isTauriReady();
}

export function NodeAccessSettings() {
	const node = useActiveNode();
	const target: ApiTarget = { url: node.url, token: node.token ?? null };
	const [token, setToken] = useState<string | null>(null);
	const [source, setSource] = useState<TokenSource>("none");
	const [revealed, setRevealed] = useState(false);
	const [pending, setPending] = useState<PairingRequest[]>([]);
	const [clients, setClients] = useState<PairedClient[]>([]);
	const [selectedScopes, setSelectedScopes] = useState<
		Record<string, string[]>
	>({});
	const [busy, setBusy] = useState(false);
	const [pairingCode, setPairingCode] = useState<string | null>(null);
	const inBrowser = !isTauri();

	const loadToken = useCallback(async () => {
		try {
			const result = await invoke<{
				source: TokenSource;
				token: string | null;
			}>("local_node_token");
			setToken(result.token);
			setSource(result.source);
		} catch {
			// A non-Tauri host (the harness, the web build) has no such command.
			setSource("none");
		}
	}, []);

	const loadPending = useCallback(async () => {
		try {
			const [requests, paired] = await Promise.all([
				request<{ requests: PairingRequest[] }>(target, "/api/pair/requests"),
				request<{ clients: PairedClient[] }>(target, "/api/pair/clients"),
			]);
			const nextRequests = requests.requests ?? [];
			setPending(nextRequests);
			setSelectedScopes((current) => {
				const next: Record<string, string[]> = {};
				for (const pairingRequest of nextRequests) {
					if (!pairingRequest.requested_scopes) {
						continue;
					}
					const previous = current[pairingRequest.user_code];
					next[pairingRequest.user_code] = previous
						? previous.filter((scope) =>
								pairingRequest.requested_scopes?.includes(scope)
							)
						: [...pairingRequest.requested_scopes];
				}
				return next;
			});
			setClients(paired.clients ?? []);
		} catch {
			// Core down, or this node does not speak pairing yet. Leave the lists
			// empty rather than surfacing a toast on a background poll.
		}
		// `target` is rebuilt each render; depend on its fields, not the object.
	}, [node.url, node.token]);

	useEffect(() => {
		void loadToken();
	}, [loadToken]);

	useEffect(() => {
		void loadPending();
		const timer = setInterval(() => void loadPending(), PENDING_POLL_MS);
		return () => clearInterval(timer);
	}, [loadPending]);

	const decide = async (userCode: string, approve: boolean) => {
		const requestToDecide = pending.find(
			(requestItem) => requestItem.user_code === userCode
		);
		setBusy(true);
		try {
			const grantedScopes = requestToDecide?.requested_scopes
				? (selectedScopes[userCode] ?? requestToDecide.requested_scopes)
				: undefined;
			await request(target, `/api/pair/${approve ? "approve" : "deny"}`, {
				method: "POST",
				body:
					approve && grantedScopes
						? {
								granted_scopes: grantedScopes,
								user_code: userCode,
							}
						: { user_code: userCode },
			});
			toast.success(approve ? "Device approved" : "Device denied", {
				id: `pair-${userCode}`,
			});
			await loadPending();
		} catch (error) {
			toast.error("Could not record that decision", {
				id: `pair-${userCode}`,
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(false);
		}
	};

	const revoke = async (client: PairedClient) => {
		setBusy(true);
		try {
			await request(target, `/api/pair/clients/${client.id}`, {
				method: "DELETE",
			});
			toast.success(`Revoked ${client.name}`, { id: `revoke-${client.id}` });
			await loadPending();
		} catch (error) {
			toast.error("Could not revoke that device", {
				id: `revoke-${client.id}`,
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(false);
		}
	};

	const rotate = async () => {
		setBusy(true);
		try {
			const result = await request<{
				message: string;
				restart_required: boolean;
			}>(target, "/api/node/token/rotate", { method: "POST" });
			toast.success("Owner token rotated", {
				id: "rotate-node-token",
				description: result.restart_required
					? `${result.message} Restart Core to finish.`
					: result.message,
			});
			await loadToken();
		} catch (error) {
			toast.error("Could not rotate the token", {
				id: "rotate-node-token",
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setBusy(false);
		}
	};

	const pairThisBrowser = async () => {
		setBusy(true);
		try {
			// Routed through `invoke` like every other node command. In the webapp
			// this hits the browser shim; in the desktop shell the command does not
			// exist, but that branch is unreachable there (`inBrowser` is false).
			// `onCode` is a live callback rather than JSON because the shim runs
			// in-process — there is no IPC boundary to serialize across.
			const paired = await invoke<boolean>("pair_local_node", {
				name: node.name,
				onCode: (code: string) => setPairingCode(code),
			});
			if (paired) {
				toast.success("This browser is now connected", { id: "pair-self" });
				// The bearer lives on the persisted node record; a reload is the
				// simplest way to get every open query to pick it up.
				window.location.reload();
			} else {
				toast.error("Pairing was denied or timed out", { id: "pair-self" });
			}
		} catch (error) {
			toast.error("Could not pair this browser", {
				id: "pair-self",
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setPairingCode(null);
			setBusy(false);
		}
	};

	const copyToken = async () => {
		if (!token) {
			return;
		}
		await navigator.clipboard.writeText(token);
		toast.success("Token copied", { id: "copy-node-token" });
	};

	if (inBrowser) {
		return (
			<div className="flex flex-col gap-4">
				<div>
					<h3 className="font-medium text-sm">Connect this browser</h3>
					<p className="text-muted-foreground text-xs">
						Your Ryu node only accepts devices you have approved. Start below,
						then approve the code in the Ryu desktop app under Devices &amp;
						access.
					</p>
				</div>

				{pairingCode ? (
					<div
						aria-live="polite"
						className="rounded-md border px-4 py-6 text-center"
						role="status"
					>
						<p className="font-mono text-2xl tracking-widest">{pairingCode}</p>
						<p className="mt-2 text-muted-foreground text-xs">
							Waiting for approval in the desktop app&hellip;
						</p>
					</div>
				) : (
					<div>
						<Button disabled={busy} onClick={() => void pairThisBrowser()}>
							Connect this browser
						</Button>
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-8">
			<section className="flex flex-col gap-3">
				<div>
					<h3 className="font-medium text-sm">Devices waiting to connect</h3>
					<p className="text-muted-foreground text-xs">
						A phone, browser, or another device asking to use this node. Check
						the code matches what that device is showing before you approve.
					</p>
				</div>

				{pending.length === 0 ? (
					<p className="rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground text-xs">
						Nothing waiting.
					</p>
				) : (
					<ul className="flex flex-col gap-2">
						{pending.map((req) => (
							<li
								className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
								key={req.user_code}
							>
								<div className="min-w-0">
									<p className="truncate font-medium text-sm">
										{req.client_name}
									</p>
									<p className="font-mono text-muted-foreground text-xs tracking-widest">
										{req.user_code}
									</p>
									{req.requested_scopes && req.requested_scopes.length > 0 ? (
										<fieldset className="mt-2">
											<legend className="text-muted-foreground text-xs">
												Grant access
											</legend>
											<p className="text-[11px] text-muted-foreground">
												Clear anything this device should not use.
											</p>
											<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
												{req.requested_scopes.map((scope, scopeIndex) => {
													const checkboxId = `pair-${req.user_code}-scope-${scopeIndex}`;
													const selected =
														selectedScopes[req.user_code] ??
														req.requested_scopes ??
														[];
													return (
														<label
															className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px]"
															htmlFor={checkboxId}
															key={scope}
														>
															<Checkbox
																checked={selected.includes(scope)}
																disabled={busy}
																id={checkboxId}
																onCheckedChange={(checked) =>
																	setSelectedScopes((current) => {
																		const currentSelection =
																			current[req.user_code] ??
																			req.requested_scopes ??
																			[];
																		return {
																			...current,
																			[req.user_code]: narrowPairingScopes({
																				checked: checked === true,
																				requested: req.requested_scopes ?? [],
																				scope,
																				selected: currentSelection,
																			}),
																		};
																	})
																}
															/>
															{scope}
														</label>
													);
												})}
											</div>
										</fieldset>
									) : (
										<ScopeList
											emptyLabel={
												req.requested_scopes
													? "No capabilities requested"
													: "Default read-only access"
											}
											label="Requested access"
											scopes={req.requested_scopes}
										/>
									)}
									<p className="mt-2 text-muted-foreground text-xs">
										Binding:{" "}
										{describePairingConstraints(req.requested_constraints).join(
											", "
										)}
									</p>
									{req.requested_expires_at == null ? null : (
										<p className="text-muted-foreground text-xs">
											Expires{" "}
											{formatPairingTimestamp(req.requested_expires_at) ??
												"at an invalid time"}
										</p>
									)}
								</div>
								<div className="flex shrink-0 gap-2">
									<Button
										aria-label={`Deny ${req.client_name}`}
										disabled={busy}
										onClick={() => void decide(req.user_code, false)}
										size="sm"
										variant="ghost"
									>
										Deny
									</Button>
									<Button
										aria-label={`Approve ${req.client_name} with requested access`}
										disabled={busy}
										onClick={() => void decide(req.user_code, true)}
										size="sm"
									>
										Approve
									</Button>
								</div>
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="flex flex-col gap-3">
				<div>
					<h3 className="font-medium text-sm">Connected devices</h3>
					<p className="text-muted-foreground text-xs">
						Devices you have already approved. Revoking one signs it out
						immediately without affecting anything else.
					</p>
				</div>
				{clients.length === 0 ? (
					<p className="rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground text-xs">
						No paired devices.
					</p>
				) : (
					<ul className="flex flex-col gap-2">
						{clients.map((client) => (
							<li
								className="flex items-start justify-between gap-3 rounded-md border px-3 py-3"
								key={client.id}
							>
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<p className="truncate font-medium text-sm">
											{client.name}
										</p>
										<span className="rounded-full border px-2 py-0.5 text-xs">
											{getPairedClientStatus(client)}
										</span>
									</div>
									<ScopeList
										emptyLabel={
											client.granted_scopes === undefined &&
											(client.schema_version ?? 0) < 2
												? "Legacy read-only access"
												: "No capabilities granted"
										}
										label="Granted access"
										scopes={client.granted_scopes}
									/>
									<p className="mt-2 text-muted-foreground text-xs">
										Binding:{" "}
										{describePairingConstraints(client.constraints).join(", ")}
									</p>
									<p className="text-muted-foreground text-xs">
										{client.expires_at == null
											? "Does not expire"
											: `Expires ${formatPairingTimestamp(client.expires_at) ?? "at an invalid time"}`}
										{client.revoked_at == null
											? ""
											: ` · Revoked ${formatPairingTimestamp(client.revoked_at) ?? "at an invalid time"}`}
									</p>
								</div>
								{canRevokePairedClient(client) ? (
									<Button
										aria-label={`Revoke ${client.name}`}
										disabled={busy}
										onClick={() => void revoke(client)}
										size="sm"
										variant="ghost"
									>
										Revoke
									</Button>
								) : null}
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="flex flex-col gap-3">
				<div>
					<h3 className="font-medium text-sm">This node's access token</h3>
					<p className="text-muted-foreground text-xs">
						Apps on this device pick this up automatically. You only need to
						copy it by hand for something that cannot ask to be approved, like a
						headless server you reach over SSH.
					</p>
				</div>

				<div className="flex flex-col gap-2">
					<Label htmlFor="node-token">Token</Label>
					<div className="flex gap-2">
						<Input
							className="font-mono text-xs"
							id="node-token"
							readOnly
							type={revealed ? "text" : "password"}
							value={token ?? ""}
						/>
						<Button
							disabled={!token}
							onClick={() => setRevealed((v) => !v)}
							size="sm"
							variant="ghost"
						>
							{revealed ? "Hide" : "Show"}
						</Button>
						<Button
							disabled={!token}
							onClick={() => void copyToken()}
							size="sm"
							variant="ghost"
						>
							Copy
						</Button>
					</div>

					{source === "env" ? (
						<p className="text-muted-foreground text-xs">
							This token comes from the <code>RYU_TOKEN</code> environment
							variable, which takes priority over the stored one. To change it,
							change that variable; rotating here would have no effect.
						</p>
					) : (
						<div className="flex items-center gap-2">
							<Button
								disabled={busy || source === "none"}
								onClick={() => void rotate()}
								size="sm"
								variant="ghost"
							>
								Rotate token
							</Button>
							<span className="text-muted-foreground text-xs">
								Takes effect immediately. Paired devices keep working.
							</span>
						</div>
					)}
				</div>
			</section>
		</div>
	);
}
