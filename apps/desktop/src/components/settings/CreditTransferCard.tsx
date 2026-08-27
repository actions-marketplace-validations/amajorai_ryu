import { CREDIT_POOLS, isCreditPoolId } from "@ryu/auth/lib/credit-pools";
import { Button } from "@ryu/ui/components/button.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@ryu/ui/components/card.tsx";
import { Checkbox } from "@ryu/ui/components/checkbox.tsx";
import { Input } from "@ryu/ui/components/input.tsx";
import { Label } from "@ryu/ui/components/label.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select.tsx";
import { toast } from "@ryu/ui/components/sileo.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import { formatMicroUsd } from "@ryu/ui/lib/number-format.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useStepUp } from "@/src/components/StepUpDialog.tsx";
import { MICRO_USD_PER_DOLLAR } from "@/src/lib/api/credits.ts";
import {
	fetchTransferable,
	hasOrgAuth,
	type OrgSummary,
	transferCredits,
} from "@/src/lib/api/orgs.ts";
import { formatDate } from "@/src/lib/timezone.ts";

/**
 * Move credits from one workspace to another.
 *
 * THE OTHER HALF OF THE PERSONAL-ORG RULE. Referral rewards are paid into the
 * earner's PERSONAL workspace and nowhere else, so that a payout firing weeks
 * later can never land in whichever org happened to be active — which for a
 * contractor may be a client's. That default is only defensible because the
 * money can then be moved here, which is why this card lives on the Credits tab
 * and why the Referrals tab points at it by name.
 *
 * Grants move WHOLE. A grant is a pool-restricted row with its own expiry, and
 * splitting one would mean two rows sharing a pool, an expiry and a remainder —
 * so the list below is checkboxes, not amount fields. Only the fungible top-up
 * balance takes a free-form number.
 *
 * The SOURCE selector lists only workspaces the user owns or administers. That
 * asymmetry is the server's (`mayTransferOutOf`): putting money INTO an org you
 * belong to harms nobody, but taking it OUT of a shared one on the strength of
 * plain membership would let any member drain a company wallet into their own.
 */

const TRANSFERABLE_KEY = ["credits", "transferable"] as const;
function formatUsd(microUsd: number): string {
	return formatMicroUsd(microUsd);
}

/**
 * The one place a workspace is named, so the closed trigger and the open list
 * cannot disagree. Base UI resolves the trigger's text from the root's `items`
 * prop alone — it never reads the `<SelectItem>` children — so without feeding
 * it these labels the trigger would print the raw org id (a cuid).
 */
function orgLabel(org: OrgSummary): string {
	return `${org.name}${org.isPersonal ? " (personal)" : ""}`;
}

function formatExpiry(iso: string | null): string | null {
	if (!iso) {
		return null;
	}
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) {
		return null;
	}
	return `expires ${formatDate(at, {
		month: "short",
		day: "numeric",
		year: "numeric",
	})}`;
}

/**
 * Word boundaries inside a pool id — see `poolDisplayName`. Module scope
 * because a literal rebuilt per call is both wasteful and a lint error.
 */
const POOL_ID_WORD_SEPARATOR = /[-_]+/;

/**
 * A grant's user-facing pool name.
 *
 * `GET /api/credits/transferable` sends the DURABLE pool id — "cloudflare",
 * "bedrock" — because that is what the grant document stores and what a debit
 * is matched against. It is not a name to show anyone. `@ryu/auth/lib/credit-pools`
 * exists to enforce exactly that ("USERS NEVER SEE A PROVIDER"): a pool's
 * `label` names a TIER ("Ryu Fast"), never the vendor supplying it. This card
 * printed the id straight through, which made it the one surface in the app
 * that leaked a vendor name — the sibling grants list on the Credits page has
 * always shown the label.
 *
 * The fallback is NOT for a pool that lacks a name — every pool in
 * `CREDIT_POOLS` has a `label`. It is for an id this BUILD has never heard of,
 * since the control plane can serve a pool that postdates the bundle. In that
 * case a title-cased id is the least-bad option available: inventing a tier
 * name would lie about money the user owns, and a raw slug reads as a bug on
 * top of leaking the vendor.
 */
function poolDisplayName(pool: string): string {
	if (isCreditPoolId(pool)) {
		return CREDIT_POOLS[pool].label;
	}
	return pool
		.split(POOL_ID_WORD_SEPARATOR)
		.filter((word) => word.length > 0)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

export function CreditTransferCard() {
	const queryClient = useQueryClient();
	const authed = hasOrgAuth();
	const [sourceOrgId, setSourceOrgId] = useState<string | null>(null);
	const [destOrgId, setDestOrgId] = useState<string | null>(null);
	const stepUp = useStepUp();
	const [selectedGrants, setSelectedGrants] = useState<Set<string>>(new Set());
	const [topupDollars, setTopupDollars] = useState("");

	const { data, isLoading } = useQuery({
		enabled: authed,
		queryFn: () => fetchTransferable(sourceOrgId),
		// The source is part of the key: the server answers "what does THIS org
		// hold", so a cache keyed only on the route would show the previous
		// workspace's grants for a beat after switching — long enough to tick one.
		queryKey: [...TRANSFERABLE_KEY, sourceOrgId ?? "default"],
	});

	const orgs = useMemo(() => data?.orgs ?? [], [data]);
	const sendableOrgs = useMemo(
		() => orgs.filter((org) => org.canSendFrom),
		[orgs]
	);
	const resolvedSource = data?.source?.orgId ?? sourceOrgId;
	const destinations = useMemo(
		() => orgs.filter((org) => org.id !== resolvedSource),
		[orgs, resolvedSource]
	);
	const sourceItems = useMemo(
		() => sendableOrgs.map((org) => ({ value: org.id, label: orgLabel(org) })),
		[sendableOrgs]
	);
	const destItems = useMemo(
		() => destinations.map((org) => ({ value: org.id, label: orgLabel(org) })),
		[destinations]
	);

	// Adopt the server's chosen source (the personal workspace) once, so the
	// select shows the org whose grants are actually listed beneath it.
	useEffect(() => {
		if (!sourceOrgId && data?.source?.orgId) {
			setSourceOrgId(data.source.orgId);
		}
	}, [data, sourceOrgId]);

	// A destination that is no longer offered (because it just became the source)
	// would silently submit the same org twice; drop it rather than let the
	// server refuse a request the UI could have prevented.
	useEffect(() => {
		if (destOrgId && !destinations.some((org) => org.id === destOrgId)) {
			setDestOrgId(null);
		}
	}, [destOrgId, destinations]);

	const grants = data?.source?.grants ?? [];
	const topupAvailable = data?.source?.topupMicroUsd ?? 0;
	const topupMicroUsd = Math.round(
		Math.max(0, Number.parseFloat(topupDollars) || 0) * MICRO_USD_PER_DOLLAR
	);
	const selectedMicroUsd = grants
		.filter((grant) => selectedGrants.has(grant.id))
		.reduce((sum, grant) => sum + grant.remainingMicroUsd, 0);

	const transferMutation = useMutation({
		mutationFn: () =>
			transferCredits({
				fromOrgId: resolvedSource as string,
				grantIds: [...selectedGrants],
				toOrgId: destOrgId as string,
				topupMicroUsd,
			}),
		onError: (error: unknown) =>
			toast.error({
				title: error instanceof Error ? error.message : "Transfer failed",
			}),
		onSuccess: async (result) => {
			setSelectedGrants(new Set());
			setTopupDollars("");
			toast.success({
				title: `Moved ${formatUsd(result.movedGrantMicroUsd + result.movedTopupMicroUsd)}`,
				// Named explicitly because a PARTIAL success is a real outcome here: a
				// grant spent between loading this list and pressing the button is
				// simply absent from the result rather than failing the whole request.
				description:
					result.movedGrantIds.length > 0
						? `${result.movedGrantIds.length} grant${result.movedGrantIds.length === 1 ? "" : "s"} moved.`
						: undefined,
			});
			await queryClient.invalidateQueries();
		},
	});

	const handleTransfer = async () => {
		try {
			await stepUp.guard("billing", () => transferMutation.mutateAsync());
		} catch {
			// React Query's onError owns the user-facing failure toast.
		}
	};

	// Nothing to move BETWEEN. A solo user has one workspace, and a transfer form
	// whose destination list is empty is a control that can only be refused.
	if (!authed || orgs.length < 2) {
		return null;
	}

	const nothingChosen = selectedGrants.size === 0 && topupMicroUsd === 0;
	const overdrawn = topupMicroUsd > topupAvailable;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Move credits</CardTitle>
				<CardDescription>
					Referral rewards are always paid into your personal workspace. Move
					them to the workspace that will spend them.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-end">
					<div className="min-w-0 flex-1 space-y-1.5">
						<Label htmlFor="transfer-source">From</Label>
						<Select
							items={sourceItems}
							onValueChange={(value: string | null) => {
								// A CLEAR IS IGNORED, not written through. Null would refetch
								// under the default key, the server would answer with the
								// personal workspace, and the adopt-once effect would write
								// that back — so clearing the field would silently snap the
								// source to personal instead of leaving it where the user put
								// it. Keeping the last real choice is the honest behaviour.
								if (!value) {
									return;
								}
								setSourceOrgId(value);
								// The grants belong to the OLD source; carrying the ticks over
								// would submit ids the new wallet does not hold.
								setSelectedGrants(new Set());
							}}
							value={resolvedSource ?? ""}
						>
							<SelectTrigger id="transfer-source">
								<SelectValue placeholder="Select a workspace" />
							</SelectTrigger>
							<SelectContent>
								{sourceItems.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<ArrowRight className="mb-2.5 hidden size-4 shrink-0 text-muted-foreground sm:block" />
					<div className="min-w-0 flex-1 space-y-1.5">
						<Label htmlFor="transfer-dest">To</Label>
						<Select
							items={destItems}
							onValueChange={(value: string | null) => setDestOrgId(value)}
							value={destOrgId ?? ""}
						>
							<SelectTrigger id="transfer-dest">
								<SelectValue placeholder="Select a workspace" />
							</SelectTrigger>
							<SelectContent>
								{destItems.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>

				{isLoading ? (
					<div className="flex justify-center py-6">
						<Spinner className="size-5" />
					</div>
				) : null}

				{grants.length > 0 ? (
					<div className="space-y-2">
						<p className="font-medium text-sm">Grants</p>
						{/* Each row moves whole — see the note at the top of this file. */}
						{grants.map((grant) => {
							const expiry = formatExpiry(grant.expiresAt);
							return (
								<label
									className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 hover:bg-muted/50"
									htmlFor={`grant-${grant.id}`}
									key={grant.id}
								>
									<Checkbox
										checked={selectedGrants.has(grant.id)}
										id={`grant-${grant.id}`}
										onCheckedChange={(next: boolean | "indeterminate") =>
											setSelectedGrants((prev) => {
												const draft = new Set(prev);
												if (next === true) {
													draft.add(grant.id);
												} else {
													draft.delete(grant.id);
												}
												return draft;
											})
										}
									/>
									<span className="min-w-0 flex-1">
										<span className="block font-medium font-mono text-sm tabular-nums">
											{formatUsd(grant.remainingMicroUsd)}
										</span>
										<span className="block text-muted-foreground text-xs">
											{poolDisplayName(grant.pool)}
											{expiry ? ` · ${expiry}` : ""}
										</span>
									</span>
								</label>
							);
						})}
					</div>
				) : null}

				<div className="space-y-1.5">
					<Label htmlFor="transfer-topup">
						Top-up balance (
						<span className="font-mono tabular-nums">
							{formatUsd(topupAvailable)}
						</span>{" "}
						available)
					</Label>
					<Input
						id="transfer-topup"
						inputMode="decimal"
						onChange={(event) => setTopupDollars(event.target.value)}
						placeholder="0.00"
						value={topupDollars}
					/>
					{overdrawn ? (
						<p className="text-destructive text-xs">
							That is more than this workspace holds.
						</p>
					) : null}
				</div>

				<div className="flex items-center justify-between gap-3">
					<p className="text-muted-foreground text-sm tabular-nums">
						{nothingChosen ? "Nothing selected" : "Moving "}
						{nothingChosen ? null : (
							<span className="font-mono text-foreground">
								{formatUsd(selectedMicroUsd + topupMicroUsd)}
							</span>
						)}
					</p>
					<Button
						disabled={
							nothingChosen || overdrawn || !(destOrgId && resolvedSource)
						}
						loading={transferMutation.isPending}
						onClick={() => void handleTransfer()}
						type="button"
					>
						{!transferMutation.isPending && <ArrowRight className="size-4" />}
						Move credits
					</Button>
				</div>
			</CardContent>
			{stepUp.dialog}
		</Card>
	);
}

export default CreditTransferCard;
