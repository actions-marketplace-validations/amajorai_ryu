"use client";

import { Badge } from "@ryu/ui/components/badge.tsx";
import { Button } from "@ryu/ui/components/button.tsx";
import { Card, CardContent } from "@ryu/ui/components/card.tsx";
import { Checkbox } from "@ryu/ui/components/checkbox.tsx";
import { Input } from "@ryu/ui/components/input.tsx";
import { Label } from "@ryu/ui/components/label.tsx";
import { ReferralPass } from "@ryu/ui/components/referral-pass.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Copy, Gift, Wallet } from "lucide-react";
import { useState } from "react";
import { sileo } from "sileo";
import type { CommissionRule } from "../utils/api-client.ts";
import { settingsApi } from "../utils/api-client.ts";
import { ReferralCreditsSection } from "./shared/referral-credits-section.tsx";

export interface ReferralsTabProps {
	/**
	 * Name printed on the invite pass. Optional because neither surface's tab
	 * owns a session — the desktop dialog and the web profile page each already
	 * have the signed-in user on hand and pass it down. Absent, the card renders
	 * unpersonalised rather than guessing.
	 */
	holderName?: string | null;
	/**
	 * The pass's metal ring follows the app's RESOLVED theme, not the OS. Both
	 * shells have a manual toggle that can disagree with `prefers-color-scheme`,
	 * and the ring is the one part of the card that cannot read the difference on
	 * its own — see `PassCardShell.metalTheme`.
	 */
	metalTheme?: "auto" | "dark" | "light";
	onOpenExternal?: (url: string) => Promise<void> | void;
}

const DASHBOARD_KEY = ["affiliate", "dashboard"] as const;
/**
 * The SAME key `ReferralCreditsSection` reads under. React Query dedupes on it,
 * so the pass's two footer numbers cost no second request — and can never
 * disagree with the list of referees rendered a few hundred pixels below them.
 */
const CREDITS_KEY = ["referrals", "credits"] as const;
const MICRO_USD_PER_USD = 1_000_000;

/**
 * MICRO-USD, not the minor units `formatMoney` takes. Kept apart for the reason
 * `referral-credits-section.tsx` states: a $15 reward through the cents
 * formatter reads as $0.15, which looks like a much worse reward rather than a
 * bug.
 */
function formatCreditsUsd(microUsd: number): string {
	const dollars = microUsd / MICRO_USD_PER_USD;
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency: "USD",
			maximumFractionDigits: dollars % 1 === 0 ? 0 : 2,
		}).format(dollars);
	} catch {
		return `$${dollars.toFixed(2)}`;
	}
}

function formatMoney(minor: number, currency: string): string {
	const code = (currency || "usd").toUpperCase();
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency: code,
		}).format(minor / 100);
	} catch {
		return `${(minor / 100).toFixed(2)} ${code}`;
	}
}

const STATUS_VARIANTS: Record<
	string,
	"default" | "secondary" | "outline" | "destructive"
> = {
	pending: "secondary",
	approved: "default",
	paid: "default",
	reversed: "destructive",
	rejected: "destructive",
};

const DEFAULT_RULE: CommissionRule = {
	type: "percent",
	value: 2000,
	recurring: false,
	durationMonths: null,
	fundedBy: "seller",
};

/**
 * The cash program's opt-in. It is a CARD, not a gate: credit rewards are
 * attributed from the share code at sign-up and pay whether or not this is ever
 * enabled, so an early return here would hide credits the user already earned —
 * and would make the two rewards look like two unrelated programs.
 */
function EnableAffiliateCard({
	onEnable,
	pending,
}: {
	onEnable: () => void;
	pending: boolean;
}) {
	return (
		<Card>
			<CardContent className="space-y-5">
				<div className="flex items-start gap-3">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<Wallet className="size-5" />
					</div>
					<div className="min-w-0 space-y-1">
						<h3 className="font-semibold text-base">
							Add cash commission to the same link
						</h3>
						<p className="text-muted-foreground text-sm">
							Your credit rewards are already running. Turn on the affiliate
							program and the same link also pays you a cash commission when a
							referred friend subscribes — both rewards, one referral.
						</p>
					</div>
				</div>
				<Button disabled={pending} onClick={onEnable} type="button">
					{pending ? (
						<Spinner className="size-4" />
					) : (
						<Gift className="size-4" />
					)}
					Enable cash commission
				</Button>
			</CardContent>
		</Card>
	);
}

export function ReferralsTab({
	holderName,
	metalTheme = "auto",
	onOpenExternal,
}: ReferralsTabProps) {
	const queryClient = useQueryClient();
	const [copied, setCopied] = useState(false);
	const [editorOpen, setEditorOpen] = useState(false);
	const [rule, setRule] = useState<CommissionRule>(DEFAULT_RULE);

	const { data, isError, isLoading } = useQuery({
		queryKey: DASHBOARD_KEY,
		queryFn: settingsApi.affiliate.get,
	});
	// The pass's footer facts. Deliberately NOT gated on the affiliate opt-in:
	// credit attribution runs from sign-up whether or not the cash program is on,
	// so a card that showed nothing until someone enabled commissions would be
	// hiding referrals they already have.
	const { data: credits } = useQuery({
		queryKey: CREDITS_KEY,
		queryFn: settingsApi.referrals.credits,
	});

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY });

	const openExternal = async (url: string) => {
		if (onOpenExternal) {
			await onOpenExternal(url);
			return;
		}
		window.open(url, "_blank", "noopener,noreferrer");
	};

	const enableMutation = useMutation({
		mutationFn: settingsApi.affiliate.enable,
		onSuccess: () => {
			invalidate();
			sileo.success({ title: "Affiliate program enabled" });
		},
		onError: (e: unknown) =>
			sileo.error({
				title: e instanceof Error ? e.message : "Failed to enable program",
			}),
	});

	const onboardMutation = useMutation({
		mutationFn: () =>
			settingsApi.affiliate.onboard({
				returnUrl: window.location.href,
				refreshUrl: window.location.href,
			}),
		onSuccess: async (result) => {
			invalidate();
			await openExternal(result.url);
		},
		onError: (e: unknown) =>
			sileo.error({
				title: e instanceof Error ? e.message : "Failed to start onboarding",
			}),
	});

	const payoutMutation = useMutation({
		mutationFn: settingsApi.affiliate.payout,
		onSuccess: () => {
			invalidate();
			sileo.success({ title: "Payout started" });
		},
		onError: (e: unknown) =>
			sileo.error({
				title: e instanceof Error ? e.message : "Failed to start payout",
			}),
	});

	const commissionMutation = useMutation({
		mutationFn: (next: CommissionRule | null) =>
			settingsApi.affiliate.setDefaultCommission(next),
		onSuccess: () => {
			invalidate();
			sileo.success({ title: "Default commission saved" });
		},
		onError: (e: unknown) =>
			sileo.error({
				title: e instanceof Error ? e.message : "Failed to save commission",
			}),
	});

	const handleCopy = async () => {
		if (!data?.referralLink) {
			return;
		}
		await navigator.clipboard.writeText(data.referralLink);
		setCopied(true);
		setTimeout(() => setCopied(false), 1800);
	};

	const openEditor = () => {
		setRule(data?.defaultCommission ?? DEFAULT_RULE);
		setEditorOpen((prev) => !prev);
	};

	if (isLoading) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center py-10">
					<Spinner className="size-5" />
				</CardContent>
			</Card>
		);
	}

	if (isError || !data) {
		return (
			<Card>
				<CardContent className="py-8 text-muted-foreground text-sm">
					Couldn't load your affiliate dashboard. Please try again.
				</CardContent>
			</Card>
		);
	}

	const { stats, payout } = data;
	const payoutsActive = payout.onboardingStatus === "active";

	return (
		<div className="space-y-4">
			{/* THE INVITE IS AN OBJECT, NOT A FORM FIELD. This was a read-only input
			    with a Copy button — the same control the app uses for an API key,
			    which is a thing you hide, where a referral is the one artefact whose
			    whole job is to be shown to another person. It is now the same
			    laminated, turning pass the waitlist queue hands out, printed with the
			    member's own code. The full LINK is still what Copy puts on the
			    clipboard; the card carries the code, which is the part a person
			    repeats out loud. */}
			{/* `overflow-visible`, against `Card`'s own baked-in `overflow-hidden`:
			    the pass is a 3D object that turns, tilts and lifts 5% under the
			    pointer, so its painted box is LARGER than the layout box it occupies.
			    Clipped to the card, a hover sheared the corners off it and a drag to
			    turn it sliced the card in half at the panel edge. Nothing else in
			    here overflows, so there is no bleed to trade away — and the cell
			    below is padded so the grown card has somewhere to grow into rather
			    than only unclipping into its neighbour's text. */}
			<Card className="overflow-visible">
				<CardContent className="grid gap-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:items-center">
					{/* The gap goes on the CELL, not on the card: the pass's own className
					    lands on the perspective host that scales, so padding there would
					    inflate the transform box rather than leave room around it. */}
					<div className="py-3">
						<ReferralPass
							className="mx-auto w-full max-w-[20rem]"
							code={data.referralCode}
							earned={
								credits ? formatCreditsUsd(credits.cap.earnedMicroUsd) : null
							}
							holder={holderName}
							joined={credits?.referrals.length ?? null}
							metalTheme={metalTheme}
						/>
					</div>

					<div className="min-w-0 space-y-5">
						<div className="flex items-start gap-3">
							<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<Gift className="size-5" />
							</div>
							<div className="min-w-0 space-y-1">
								<h3 className="font-semibold text-base">Your invite pass</h3>
								<p className="text-muted-foreground text-sm">
									One link, two rewards. You earn Ryu credits when a friend who
									signed up through it becomes a paying customer
									{data.enabled
										? ", plus a cash commission on what they subscribe to."
										: "."}
								</p>
							</div>
						</div>

						<div className="flex flex-col gap-2 sm:flex-row">
							<Input
								readOnly
								value={data.referralLink ?? "Generating your link…"}
							/>
							<Button
								disabled={!data.referralLink}
								onClick={handleCopy}
								type="button"
								variant="outline"
							>
								<Copy className="size-4" />
								{copied ? "Copied" : "Copy"}
							</Button>
						</div>
						{/* Credit rewards land in the earner's PERSONAL org, always — never
						    in whichever org is active when the payout fires, which may be a
						    client's. Said here because it is surprising the first time and
						    because the Credits tab is where the money can then be moved. */}
						<p className="text-muted-foreground text-xs">
							Referral credits are always paid into your personal workspace.
							Move them to a company workspace any time from Credits.
						</p>
					</div>
				</CardContent>
			</Card>

			<ReferralCreditsSection />

			{data.enabled ? null : (
				<EnableAffiliateCard
					onEnable={() => enableMutation.mutate()}
					pending={enableMutation.isPending}
				/>
			)}

			{data.enabled ? (
				<>
					<div className="space-y-2">
						<div className="flex items-center gap-2">
							<Wallet className="size-4 text-muted-foreground" />
							<h3 className="font-semibold text-base">Cash commission</h3>
						</div>
						<p className="text-muted-foreground text-sm">
							The second half of the same referral: paid in money, not credits,
							once a referred friend subscribes.
						</p>
						<div className="grid gap-3 pt-1 sm:grid-cols-3">
							<Card>
								<CardContent className="space-y-1 py-4">
									<p className="text-muted-foreground text-xs uppercase">
										Pending
									</p>
									<p className="font-semibold text-lg">
										{formatMoney(stats.pendingMinor, stats.currency)}
									</p>
								</CardContent>
							</Card>
							<Card>
								<CardContent className="space-y-1 py-4">
									<p className="text-muted-foreground text-xs uppercase">
										Approved
									</p>
									<p className="font-semibold text-lg">
										{formatMoney(stats.approvedMinor, stats.currency)}
									</p>
								</CardContent>
							</Card>
							<Card>
								<CardContent className="space-y-1 py-4">
									<p className="text-muted-foreground text-xs uppercase">
										Paid
									</p>
									<p className="font-semibold text-lg">
										{formatMoney(stats.paidMinor, stats.currency)}
									</p>
								</CardContent>
							</Card>
						</div>
					</div>

					<Card>
						<CardContent className="space-y-4">
							<div className="flex items-start gap-3">
								<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
									<Wallet className="size-5" />
								</div>
								<div className="min-w-0 space-y-1">
									<h3 className="font-semibold text-base">Payout account</h3>
									<p className="text-muted-foreground text-sm">
										{payoutsActive
											? "Your Stripe account is connected and ready to receive payouts."
											: "Connect a Stripe account to receive your commission payouts."}
									</p>
								</div>
							</div>

							{payoutsActive ? (
								<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
									<Badge variant="secondary">Payouts enabled</Badge>
									<Button
										className="sm:ml-auto"
										disabled={
											payoutMutation.isPending || stats.approvedMinor <= 0
										}
										onClick={() => payoutMutation.mutate()}
										type="button"
									>
										{payoutMutation.isPending ? (
											<Spinner className="size-4" />
										) : (
											<Wallet className="size-4" />
										)}
										Pay out approved balance
									</Button>
								</div>
							) : (
								<Button
									disabled={onboardMutation.isPending}
									onClick={() => onboardMutation.mutate()}
									type="button"
								>
									{onboardMutation.isPending ? (
										<Spinner className="size-4" />
									) : (
										<Wallet className="size-4" />
									)}
									Set up payouts
								</Button>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardContent className="space-y-4">
							<button
								className="flex w-full items-center justify-between gap-2 text-left"
								onClick={openEditor}
								type="button"
							>
								<div className="min-w-0">
									<h3 className="font-semibold text-base">
										Marketplace default commission
									</h3>
									<p className="text-muted-foreground text-sm">
										The commission applied to your marketplace listings unless
										overridden per item.
									</p>
								</div>
								<ChevronDown
									className={`size-4 shrink-0 text-muted-foreground transition-transform ${
										editorOpen ? "rotate-180" : ""
									}`}
								/>
							</button>

							{editorOpen ? (
								<div className="space-y-4 border-t pt-4">
									<div className="grid gap-4 sm:grid-cols-2">
										<div className="space-y-1.5">
											<Label htmlFor="commission-type">Type</Label>
											<Select
												onValueChange={(value) =>
													setRule((prev) => ({
														...prev,
														type: value as CommissionRule["type"],
													}))
												}
												value={rule.type}
											>
												<SelectTrigger className="w-full" id="commission-type">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="percent">Percent</SelectItem>
													<SelectItem value="flat">Flat</SelectItem>
												</SelectContent>
											</Select>
										</div>

										<div className="space-y-1.5">
											<Label htmlFor="commission-value">
												{rule.type === "percent"
													? "Value (basis points)"
													: "Value (cents)"}
											</Label>
											<Input
												id="commission-value"
												inputMode="numeric"
												min={0}
												onChange={(e) =>
													setRule((prev) => ({
														...prev,
														value: Number(e.target.value) || 0,
													}))
												}
												type="number"
												value={rule.value}
											/>
										</div>

										<div className="space-y-1.5">
											<Label htmlFor="commission-funded">Funded by</Label>
											<Select
												onValueChange={(value) =>
													setRule((prev) => ({
														...prev,
														fundedBy: value as CommissionRule["fundedBy"],
													}))
												}
												value={rule.fundedBy}
											>
												<SelectTrigger
													className="w-full"
													id="commission-funded"
												>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="platform">Platform</SelectItem>
													<SelectItem value="seller">Seller</SelectItem>
												</SelectContent>
											</Select>
										</div>

										<div className="space-y-1.5">
											<Label htmlFor="commission-duration">
												Duration (months, blank = forever)
											</Label>
											<Input
												disabled={!rule.recurring}
												id="commission-duration"
												inputMode="numeric"
												min={1}
												onChange={(e) =>
													setRule((prev) => ({
														...prev,
														durationMonths:
															e.target.value === ""
																? null
																: Number(e.target.value) || null,
													}))
												}
												placeholder="Forever"
												type="number"
												value={rule.durationMonths ?? ""}
											/>
										</div>
									</div>

									<label
										className="flex cursor-pointer items-center gap-2"
										htmlFor="commission-recurring"
									>
										<Checkbox
											checked={rule.recurring}
											id="commission-recurring"
											onCheckedChange={(checked) =>
												setRule((prev) => ({
													...prev,
													recurring: checked === true,
													durationMonths:
														checked === true ? prev.durationMonths : null,
												}))
											}
										/>
										<span className="text-sm">Recurring commission</span>
									</label>

									<div className="flex flex-wrap gap-2">
										<Button
											disabled={commissionMutation.isPending}
											onClick={() => commissionMutation.mutate(rule)}
											type="button"
										>
											{commissionMutation.isPending ? (
												<Spinner className="size-4" />
											) : null}
											Save
										</Button>
										<Button
											disabled={
												commissionMutation.isPending || !data.defaultCommission
											}
											onClick={() => commissionMutation.mutate(null)}
											type="button"
											variant="outline"
										>
											Clear
										</Button>
									</div>
								</div>
							) : null}
						</CardContent>
					</Card>

					<Card>
						<CardContent className="space-y-3">
							<h3 className="font-semibold text-base">Recent commissions</h3>
							{data.recentCommissions.length === 0 ? (
								<p className="py-4 text-center text-muted-foreground text-sm">
									No commissions yet. Share your link to start earning.
								</p>
							) : (
								<div className="space-y-2">
									{data.recentCommissions.map((commission) => (
										<div
											className="flex items-center justify-between gap-3 rounded-lg border p-3"
											key={commission.id}
										>
											<div className="min-w-0">
												<p className="truncate font-medium text-sm">
													{commission.sourceType}
												</p>
												<p className="text-muted-foreground text-xs">
													{formatMoney(
														commission.commissionAmountMinor,
														commission.currency
													)}
												</p>
											</div>
											<Badge
												variant={
													STATUS_VARIANTS[commission.status] ?? "outline"
												}
											>
												{commission.status}
											</Badge>
										</div>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</>
			) : null}
		</div>
	);
}
