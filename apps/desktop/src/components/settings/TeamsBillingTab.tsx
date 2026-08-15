import { UserGroupIcon, Wallet01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@ryu/ui/components/button";
import { Input } from "@ryu/ui/components/input";
import { Spinner } from "@ryu/ui/components/spinner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { sileo } from "sileo";
import { FRONTEND_URL } from "@/lib/auth-client.ts";
import { openExternal } from "@/lib/tauri-bridge.ts";
import { useBillingStatusStream } from "@/src/hooks/useBillingStatusStream.ts";
import { useActiveOrgId } from "@/src/lib/api/orgs.ts";
import {
	checkoutTeams,
	fetchOrgRole,
	fetchSeatStatus,
	fetchSubscriptionStatus,
	fetchWallet,
	hasTeamsBillingAuth,
	openBillingPortalUrl,
	setSeats,
	TeamsBillingError,
} from "@/src/lib/api/teams-billing.ts";
import {
	SettingsCard,
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

const MICRO_USD_PER_DOLLAR = 1_000_000;

function formatMicroUsd(microUsd: number): string {
	return (microUsd / MICRO_USD_PER_DOLLAR).toLocaleString(undefined, {
		style: "currency",
		currency: "USD",
	});
}

/** Where a solo user goes to create or pick an organization. */
const ORGANIZATIONS_URL = `${FRONTEND_URL.replace(/\/$/, "")}/organizations`;

/** Friendly labels for the internal plan slugs the backend returns. */
const PLAN_LABELS: Record<string, string> = {
	free: "Free",
	hobby: "Hobby",
	pro: "Pro",
	teams: "Ryu Teams",
};

function planLabel(plan: string | null | undefined): string {
	if (!plan) {
		return "No plan";
	}
	return PLAN_LABELS[plan] ?? plan.charAt(0).toUpperCase() + plan.slice(1);
}

/**
 * Desktop mirror of the org-scoped Teams billing surface (epic #496, Unit D1).
 *
 * An owner/admin subscribes the org to Teams, sets the seat count (validated
 * server-side vs the live member count), and tops up / changes the plan via the
 * Polar portal. Every member SEES the pooled wallet + monthly pool; only
 * owner/admin can mutate. RBAC is enforced SERVER-SIDE — this tab only hides the
 * controls as a courtesy (it surfaces the server's 403 if reached anyway).
 *
 * Rendered per active org by {@link TeamsBillingTab}, which is why every route
 * below can resolve its org from the session and take no org argument: the id
 * arrives as a prop that cannot change under this component.
 */
function TeamsBillingTabForOrg({
	activeOrgId,
}: {
	activeOrgId: string | null;
}) {
	const authed = hasTeamsBillingAuth();

	const subQuery = useQuery({
		enabled: authed,
		queryKey: ["teams-subscription-status", activeOrgId],
		queryFn: fetchSubscriptionStatus,
	});
	const seatQuery = useQuery({
		enabled: authed,
		queryKey: ["teams-seat-status", activeOrgId],
		queryFn: fetchSeatStatus,
		retry: false,
	});
	const walletQuery = useQuery({
		enabled: authed,
		queryKey: ["teams-wallet", activeOrgId],
		queryFn: fetchWallet,
		// Same `retry: false` as the seat query above, for the same reason: the
		// wallet is org-level, so a caller with no active org gets a 409 that three
		// more attempts cannot turn into a wallet.
		retry: false,
	});
	const organizationId = seatQuery.data?.organizationId;
	const roleQuery = useQuery({
		enabled: authed && Boolean(organizationId),
		queryKey: ["teams-org-role", organizationId],
		queryFn: () => fetchOrgRole(organizationId as string),
	});

	// Live billing status: a Polar/Stripe webhook changing the plan or seat count
	// pushes a fresh snapshot over SSE, which we write straight into the same
	// query caches the tab renders from — so plan/seat changes made elsewhere (or
	// by another admin) reflect here without a refetch. `seats` is null for a
	// user-scope caller with no org, so only the subscription cache updates then.
	//
	// These keys MUST stay byte-identical to the `useQuery` keys above, org id
	// included: a writer aimed at a key nothing reads fails silently — the tab
	// simply stops receiving live updates, with no error to notice.
	//
	// `activeOrgId` is a PROP that is constant for this component's lifetime, and
	// that is what makes the writer safe. `useBillingStatusStream` holds the last
	// snapshot in `useState` behind a mount-once effect, so it still holds the
	// PREVIOUS org's snapshot at the instant a switch changes the id: re-running
	// this writer on that change alone would file org A's plan and seat count
	// under org B's keys and paint them as org B's. The switch remounts this
	// component instead (see the wrapper below), which clears that snapshot to
	// null and reopens the stream, so every write here is same-org by
	// construction rather than by a guard someone could drop.
	const queryClient = useQueryClient();
	const liveBilling = useBillingStatusStream();
	useEffect(() => {
		if (!liveBilling) {
			return;
		}
		queryClient.setQueryData(
			["teams-subscription-status", activeOrgId],
			liveBilling.subscription
		);
		if (liveBilling.seats) {
			queryClient.setQueryData(
				["teams-seat-status", activeOrgId],
				liveBilling.seats
			);
		}
	}, [liveBilling, queryClient, activeOrgId]);

	const [seats, setSeatsInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [seatError, setSeatError] = useState<string | null>(null);

	const billed = seatQuery.data?.billedSeats ?? null;
	const minRequired = seatQuery.data?.minRequired ?? 2;
	useEffect(() => {
		setSeatsInput(String(billed ?? minRequired));
	}, [billed, minRequired]);

	if (!authed) {
		return (
			<SettingsSection title="Teams">
				<p className="px-3 text-muted-foreground text-sm">
					Sign in to manage your organization&apos;s Teams plan.
				</p>
			</SettingsSection>
		);
	}

	const noOrg =
		seatQuery.error instanceof TeamsBillingError &&
		seatQuery.error.kind === "no_org";
	if (noOrg) {
		return (
			<SettingsSection title="Teams">
				<SettingsCard>
					<div className="flex flex-col items-start gap-3">
						<p className="text-muted-foreground text-sm">
							Teams is an organization plan. Create or join an organization to
							set up shared credits and seats.
						</p>
						<Button
							onClick={() => {
								openExternal(ORGANIZATIONS_URL).catch(() => undefined);
							}}
							size="sm"
						>
							Create or select an organization
						</Button>
					</div>
				</SettingsCard>
			</SettingsSection>
		);
	}

	const loadFailed =
		subQuery.isError ||
		walletQuery.isError ||
		roleQuery.isError ||
		(seatQuery.isError && !noOrg);
	if (loadFailed) {
		return (
			<SettingsSection title="Teams">
				<SettingsCard>
					<div className="flex flex-col items-start gap-3">
						<p className="text-muted-foreground text-sm">
							We couldn&apos;t load your Teams billing details. Check your
							connection and try again.
						</p>
						<Button
							onClick={() => {
								subQuery.refetch().catch(() => undefined);
								seatQuery.refetch().catch(() => undefined);
								walletQuery.refetch().catch(() => undefined);
								roleQuery.refetch().catch(() => undefined);
							}}
							size="sm"
							variant="ghost"
						>
							Try again
						</Button>
					</div>
				</SettingsCard>
			</SettingsSection>
		);
	}

	const role = roleQuery.data ?? null;
	const canManage = role === "owner" || role === "admin";
	const isTeams = subQuery.data?.plan === "teams";
	const pool = subQuery.data?.entitlement.monthlyCreditPoolMicroUsd ?? 0;
	const memberCount = seatQuery.data?.memberCount ?? 0;
	const overAllocated = Boolean(seatQuery.data?.overAllocated);

	const subscribe = async () => {
		setBusy(true);
		try {
			const parsed = Number.parseInt(seats, 10);
			const { url } = await checkoutTeams(
				Number.isFinite(parsed) ? parsed : minRequired
			);
			await openExternal(url);
		} catch (err) {
			sileo.error({
				title:
					err instanceof TeamsBillingError
						? err.message
						: "Failed to start checkout.",
			});
		} finally {
			setBusy(false);
		}
	};

	const manage = async () => {
		setBusy(true);
		try {
			const { url } = await openBillingPortalUrl();
			await openExternal(url);
		} catch (err) {
			sileo.error({
				title:
					err instanceof TeamsBillingError
						? err.message
						: "Failed to open billing portal.",
			});
		} finally {
			setBusy(false);
		}
	};

	const saveSeats = async () => {
		const parsed = Number.parseInt(seats, 10);
		if (!Number.isInteger(parsed) || parsed < minRequired) {
			setSeatError(
				`Enter a whole number of seats, at least ${minRequired} for this organization.`
			);
			return;
		}
		setBusy(true);
		setSeatError(null);
		try {
			await setSeats(parsed);
			await seatQuery.refetch();
			await subQuery.refetch();
			sileo.success({ title: "Seats updated." });
		} catch (err) {
			setSeatError(
				err instanceof TeamsBillingError ? err.message : "Failed to set seats."
			);
		} finally {
			setBusy(false);
		}
	};

	const loading =
		subQuery.isLoading || seatQuery.isLoading || walletQuery.isLoading;

	return (
		<div className="space-y-6">
			<SettingsSection title="Plan">
				{loading ? (
					<SettingsCard>
						<Spinner className="size-4" />
					</SettingsCard>
				) : (
					<SettingsGroup>
						<SettingsItem
							actions={
								canManage ? (
									isTeams ? (
										<Button
											disabled={busy}
											onClick={manage}
											size="sm"
											variant="ghost"
										>
											Change or cancel
										</Button>
									) : (
										<Button disabled={busy} onClick={subscribe} size="sm">
											Subscribe to Teams
										</Button>
									)
								) : undefined
							}
							description={
								isTeams
									? `Your organization is on the Teams plan (${subQuery.data?.seats} seats).`
									: "Subscribe your organization to the Teams plan to share one pool of AI credits across your whole team, with a seat for each member."
							}
							title={
								<span className="flex items-center gap-2">
									<HugeiconsIcon
										className="size-4 text-muted-foreground"
										icon={UserGroupIcon}
									/>
									{isTeams ? "Ryu Teams" : planLabel(subQuery.data?.plan)}
								</span>
							}
						/>
					</SettingsGroup>
				)}
			</SettingsSection>

			{isTeams && (
				<SettingsSection title="Seats">
					<SettingsGroup>
						<SettingsItem
							description={`${memberCount} member${
								memberCount === 1 ? "" : "s"
							} in this organization${
								billed === null
									? ""
									: ` · ${billed} seat${billed === 1 ? "" : "s"} billed`
							}. A seat is required for every member who uses shared AI credits.`}
							title="Allocated seats"
						/>
						{overAllocated && (
							<SettingsItem
								description="You have more members than seats. Increase the seat count to cover everyone."
								title={
									<span className="font-medium text-destructive">
										More members than seats
									</span>
								}
							/>
						)}
						{canManage ? (
							<SettingsItem
								actions={
									<div className="flex items-center gap-2">
										<Input
											className="w-20"
											min={minRequired}
											onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
												setSeatsInput(e.target.value)
											}
											type="number"
											value={seats}
										/>
										<Button disabled={busy} onClick={saveSeats} size="sm">
											{busy ? "Saving..." : "Update"}
										</Button>
									</div>
								}
								description={
									seatError ? (
										<span className="text-destructive">{seatError}</span>
									) : (
										`Minimum ${minRequired} seats for this organization.`
									)
								}
								title="Set seat count"
							/>
						) : (
							<SettingsItem
								description="Only an organization owner or admin can change the seat count."
								title="Seat management"
							/>
						)}
					</SettingsGroup>
				</SettingsSection>
			)}

			<SettingsSection title="Pooled wallet">
				{walletQuery.isLoading ? (
					<SettingsCard>
						<Spinner className="size-4" />
					</SettingsCard>
				) : (
					<SettingsGroup>
						<SettingsItem
							actions={
								<span className="font-heading font-semibold text-sm tabular-nums">
									{walletQuery.data
										? formatMicroUsd(walletQuery.data.wallet.balanceMicroUsd)
										: "—"}
								</span>
							}
							description="A shared credit balance for the whole organization."
							title={
								<span className="flex items-center gap-2">
									<HugeiconsIcon
										className="size-4 text-muted-foreground"
										icon={Wallet01Icon}
									/>
									Current balance
								</span>
							}
						/>
						<SettingsItem
							actions={
								<span className="font-heading font-semibold text-sm tabular-nums">
									{pool > 0 ? formatMicroUsd(pool) : "—"}
								</span>
							}
							description="Refreshed each billing period while the subscription is active."
							title="Monthly included pool"
						/>
					</SettingsGroup>
				)}
			</SettingsSection>
		</div>
	);
}

/**
 * The tab itself: one instance of {@link TeamsBillingTabForOrg} PER WORKSPACE.
 *
 * CLEAR FIRST, THEN LOAD — as a remount, because this tab's staleness is not
 * only in the query cache. Its live SSE snapshot and its seat input are plain
 * component state; re-keying the queries underneath them would leave the plan,
 * the seat count and the number in the input box describing the workspace the
 * user just left. Keying on the active org drops all of it in one step: the
 * queries come back pending (a spinner, not another org's plan), the seat input
 * re-derives from the new org's billed seats, and the billing stream is torn
 * down and reopened — so the snapshot it was holding for the previous workspace
 * cannot be written into this one's cache keys.
 *
 * The `null` key is the pre-resolution state, not a workspace. On a cold cache
 * it costs one extra stream reconnect when the id lands — which is the point: a
 * stream opened before the id was known cannot be assumed to describe the org
 * the tab settles on.
 */
export function TeamsBillingTab() {
	const activeOrgId = useActiveOrgId();
	return (
		<TeamsBillingTabForOrg
			activeOrgId={activeOrgId}
			key={activeOrgId ?? "pending"}
		/>
	);
}
