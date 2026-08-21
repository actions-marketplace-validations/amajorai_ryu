import { Robot01Icon, Wallet01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	hostedAgentIncludedCreditUsd,
	TEAMS_AGENT_STANDARD_USD,
	TEAMS_MAX_SEATS,
	TEAMS_MIN_SEATS,
} from "@ryu/blocks/web/pricing.tsx";
import { BeforeAfterSummary } from "@ryu/ui/components/before-after-summary.tsx";
import { Button } from "@ryu/ui/components/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog.tsx";
import { Input } from "@ryu/ui/components/input.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import { formatMicroUsd } from "@ryu/ui/lib/number-format.ts";
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
	fetchSubscriptionStatus,
	fetchTeamsSeatStatus,
	fetchWallet,
	type HostedAgentPlanId,
	hasTeamsBillingAuth,
	openBillingPortalUrl,
	TeamsBillingError,
	updateTeamsSeats,
} from "@/src/lib/api/teams-billing.ts";
import {
	SettingsCard,
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

/** Where a solo user goes to create or pick an organization. */
const ORGANIZATIONS_URL = `${FRONTEND_URL.replace(/\/$/, "")}/organizations`;

/** Friendly labels for the internal plan slugs the backend returns. */
const PLAN_LABELS: Record<string, string> = {
	free: "Free",
	hobby: "Hobby",
	max: "Max Plan",
	pro: "Pro Plan",
	teams: "For Teams",
};

function planLabel(plan: string | null | undefined): string {
	if (!plan) {
		return "No plan";
	}
	return PLAN_LABELS[plan] ?? plan.charAt(0).toUpperCase() + plan.slice(1);
}

function normalizeTeamsSeatCount(
	value: string,
	minimum = TEAMS_MIN_SEATS
): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) {
		return minimum;
	}
	return Math.max(minimum, Math.floor(parsed));
}

function formatMonthlyUsd(value: number): string {
	return `${formatMicroUsd(Math.round(value * 1_000_000))}/mo`;
}

function legacyPlanAmount(plan: string | null | undefined): string {
	switch (plan) {
		case "max":
			return "$99/mo";
		case "pro":
			return "$39/mo";
		case "teams":
			return "$250/mo";
		default:
			return "$0/mo";
	}
}

/**
 * Desktop mirror of the organization Teams seat-billing surface.
 *
 * The organization member count is the access boundary and Polar owns the
 * billed quantity. The AI-credit pool is bundled by billed seat count and
 * shared. Only
 * owner/admin can mutate billing; the control-plane server is authoritative.
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
	const walletQuery = useQuery({
		enabled: authed,
		queryKey: ["teams-wallet", activeOrgId],
		queryFn: fetchWallet,
		retry: false,
	});
	const organizationId = subQuery.data?.organizationId ?? activeOrgId;
	const roleQuery = useQuery({
		enabled: authed && Boolean(organizationId),
		queryKey: ["teams-org-role", organizationId],
		queryFn: () => fetchOrgRole(organizationId as string),
	});
	const seatQuery = useQuery({
		enabled: authed && Boolean(organizationId),
		queryKey: ["teams-seat-status", organizationId],
		queryFn: fetchTeamsSeatStatus,
	});

	// Live webhook snapshots update the same subscription cache as the initial
	// request, so a plan or seat change made in another billing surface is
	// reflected here without a refresh.
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
	}, [liveBilling, queryClient, activeOrgId]);

	const [seatText, setSeatText] = useState(String(TEAMS_MIN_SEATS));
	const [reviewOpen, setReviewOpen] = useState(false);
	const [reviewPending, setReviewPending] = useState(false);
	const [reviewError, setReviewError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const seatStatus = seatQuery.data ?? null;
	const isTeams = subQuery.data?.plan === "teams";
	const seatMinimum = seatStatus?.minRequired ?? TEAMS_MIN_SEATS;
	const previewSeatCount = normalizeTeamsSeatCount(seatText, seatMinimum);
	const previewMonthlyPrice = TEAMS_AGENT_STANDARD_USD * previewSeatCount;
	const previewCreditPool = hostedAgentIncludedCreditUsd(
		"teams",
		previewSeatCount
	);

	useEffect(() => {
		const currentSeats = seatStatus?.billedSeats ?? seatStatus?.minRequired;
		setSeatText(String(currentSeats ?? TEAMS_MIN_SEATS));
	}, [seatStatus?.billedSeats, seatStatus?.minRequired]);

	if (!authed) {
		return (
			<SettingsSection title="For Teams">
				<p className="px-3 text-muted-foreground text-sm">
					Sign in to manage your organization&apos;s Teams seats.
				</p>
			</SettingsSection>
		);
	}

	const noOrg = !activeOrgId;
	if (noOrg) {
		return (
			<SettingsSection title="For Teams">
				<SettingsCard>
					<div className="flex flex-col items-start gap-3">
						<p className="text-muted-foreground text-sm">
							For Teams is an organization plan. Create or join an organization
							to set up shared credits and member seats.
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
		seatQuery.isError;
	if (loadFailed) {
		return (
			<SettingsSection title="For Teams">
				<SettingsCard>
					<div className="flex flex-col items-start gap-3">
						<p className="text-muted-foreground text-sm">
							We couldn&apos;t load your organization billing details. Check
							your connection and try again.
						</p>
						<Button
							onClick={() => {
								subQuery.refetch().catch(() => undefined);
								walletQuery.refetch().catch(() => undefined);
								roleQuery.refetch().catch(() => undefined);
								seatQuery.refetch().catch(() => undefined);
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
	const loading =
		subQuery.isLoading || walletQuery.isLoading || seatQuery.isLoading;
	const currentPlanId = subQuery.data?.plan as HostedAgentPlanId | null;
	const currentSeats =
		seatStatus?.billedSeats ?? seatStatus?.minRequired ?? TEAMS_MIN_SEATS;
	const currentAmount = isTeams
		? formatMonthlyUsd(TEAMS_AGENT_STANDARD_USD * currentSeats)
		: legacyPlanAmount(subQuery.data?.plan);
	const currentDetail = isTeams
		? `${currentSeats} billed seats${seatStatus?.bonusSeats ? ` + ${seatStatus.bonusSeats} negotiated` : ""} · ${seatStatus?.memberCount ?? 0} active members · shared workspace access`
		: subQuery.data?.plan
			? "Existing organization plan"
			: "No active Teams plan";

	const startCheckout = async () => {
		setReviewError(null);
		setReviewPending(true);
		try {
			const { url } = await checkoutTeams(
				"monthly",
				previewSeatCount,
				organizationId
			);
			await openExternal(url);
			setReviewOpen(false);
		} catch (error) {
			const message =
				error instanceof TeamsBillingError
					? error.message
					: "Failed to start checkout.";
			setReviewError(message);
		} finally {
			setReviewPending(false);
		}
	};

	const saveSeats = async () => {
		if (previewSeatCount > TEAMS_MAX_SEATS) {
			sileo.error({
				title: `Teams self-serve covers up to ${TEAMS_MAX_SEATS} seats`,
				description: "Contact Enterprise for larger organizations.",
			});
			return;
		}
		setBusy(true);
		try {
			await updateTeamsSeats(previewSeatCount);
			await seatQuery.refetch();
			sileo.success({ title: "Teams seats updated" });
		} catch (error) {
			sileo.error({
				title:
					error instanceof TeamsBillingError
						? error.message
						: "Failed to update Teams seats",
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
		} catch (error) {
			sileo.error({
				title:
					error instanceof TeamsBillingError
						? error.message
						: "Failed to open billing portal.",
			});
		} finally {
			setBusy(false);
		}
	};

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
										<div className="flex items-center gap-2">
											<Input
												aria-label="Teams seats"
												className="w-24"
												max={TEAMS_MAX_SEATS}
												min={seatMinimum}
												onChange={(event) => setSeatText(event.target.value)}
												step={1}
												type="number"
												value={seatText}
											/>
											<Button
												disabled={busy}
												onClick={() => void saveSeats()}
												size="sm"
											>
												Save seats
											</Button>
											<Button
												disabled={busy}
												onClick={() => void manage()}
												size="sm"
												variant="ghost"
											>
												Manage billing
											</Button>
										</div>
									) : (
										<div className="flex items-center gap-2">
											<Input
												aria-label="Teams seats"
												className="w-24"
												max={TEAMS_MAX_SEATS}
												min={seatMinimum}
												onChange={(event) => setSeatText(event.target.value)}
												step={1}
												type="number"
												value={seatText}
											/>
											<Button
												disabled={busy}
												onClick={() => {
													setReviewError(null);
													setReviewOpen(true);
												}}
												size="sm"
											>
												Review For Teams
											</Button>
										</div>
									)
								) : undefined
							}
							description={
								isTeams
									? `Your organization is on For Teams (${seatStatus?.includedSeats ?? currentSeats} member capacity: ${currentSeats} billed${seatStatus?.bonusSeats ? ` + ${seatStatus.bonusSeats} negotiated` : ""} · ${seatStatus?.memberCount ?? 0} active members).`
									: "Subscribe your organization to For Teams for shared managed inference and member seats."
							}
							title={
								<span className="flex items-center gap-2">
									<HugeiconsIcon
										className="size-4 text-muted-foreground"
										icon={Robot01Icon}
									/>
									{isTeams ? "For Teams" : planLabel(subQuery.data?.plan)}
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
							description={`${seatStatus?.memberCount ?? 0} active members and ${seatStatus?.pendingSeatReservations ?? 0} in-flight invitation claims. Capacity is ${seatStatus?.includedSeats ?? "—"} (${currentSeats} billed${seatStatus?.bonusSeats ? ` + ${seatStatus.bonusSeats} negotiated` : ""}); the shared pool adds $50 per five billed seats.`}
							title="Member seats"
						/>
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
									{(subQuery.data?.entitlement.monthlyCreditPoolMicroUsd ?? 0) >
									0
										? formatMicroUsd(
												subQuery.data?.entitlement.monthlyCreditPoolMicroUsd ??
													0
											)
										: "—"}
								</span>
							}
							description="Refreshed each billing period while the plan is active."
							title="Monthly included pool"
						/>
					</SettingsGroup>
				)}
			</SettingsSection>

			<Dialog
				onOpenChange={(open) => {
					setReviewOpen(open);
					if (!open) {
						setReviewError(null);
					}
				}}
				open={reviewOpen}
			>
				<DialogContent showCloseButton={!reviewPending}>
					<DialogHeader>
						<DialogTitle>Review plan change</DialogTitle>
						<DialogDescription>
							Review the organization plan and member-seat quantity before Ryu
							opens the secure checkout.
						</DialogDescription>
					</DialogHeader>
					<BeforeAfterSummary
						current={{
							amount: currentAmount,
							detail: currentDetail,
							eyebrow: "Current",
							label: planLabel(currentPlanId),
						}}
						footer={{
							detail: `Shared AI pool: ${formatMicroUsd(Math.round(previewCreditPool * 1_000_000))}/mo. It adds $50 per five billed seats. Each additional billed member seat is $${TEAMS_AGENT_STANDARD_USD}/mo.`,
							label: "New allowance",
							value: `${previewSeatCount} member seats`,
						}}
						next={{
							amount: formatMonthlyUsd(previewMonthlyPrice),
							detail: `${previewSeatCount} member seats · shared workspace · pooled wallet`,
							eyebrow: "New",
							label: "For Teams",
						}}
					/>
					{reviewError ? (
						<p className="text-destructive text-sm" role="alert">
							{reviewError}
						</p>
					) : null}
					<DialogFooter>
						<DialogClose
							disabled={reviewPending}
							render={<Button disabled={reviewPending} variant="ghost" />}
						>
							Cancel
						</DialogClose>
						<Button
							loading={reviewPending}
							onClick={() => void startCheckout()}
						>
							Continue to checkout
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

/**
 * One instance per active workspace. Keying by the org clears the query,
 * live-stream, and agent input state together when the workspace
 * changes, so billing details never bleed between organizations.
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
