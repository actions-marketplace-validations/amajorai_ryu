"use client";

import { Badge } from "@ryu/ui/components/badge";
import { Button } from "@ryu/ui/components/button";
import { Card, CardContent } from "@ryu/ui/components/card";
import { Checkbox } from "@ryu/ui/components/checkbox";
import { Input } from "@ryu/ui/components/input";
import { Label } from "@ryu/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select";
import { Spinner } from "@ryu/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Copy, Gift, Wallet } from "lucide-react";
import { useState } from "react";
import { sileo } from "sileo";
import type { CommissionRule } from "../utils/api-client.ts";
import { settingsApi } from "../utils/api-client.ts";
import { ReferralCreditsSection } from "./shared/referral-credits-section.tsx";

export interface ReferralsTabProps {
	onOpenExternal?: (url: string) => Promise<void> | void;
}

const DASHBOARD_KEY = ["affiliate", "dashboard"] as const;

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

export function ReferralsTab({ onOpenExternal }: ReferralsTabProps) {
	const queryClient = useQueryClient();
	const [copied, setCopied] = useState(false);
	const [editorOpen, setEditorOpen] = useState(false);
	const [rule, setRule] = useState<CommissionRule>(DEFAULT_RULE);

	const { data, isError, isLoading } = useQuery({
		queryKey: DASHBOARD_KEY,
		queryFn: settingsApi.affiliate.get,
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
			<Card className="overflow-hidden">
				<CardContent className="space-y-5">
					<div className="flex items-start gap-3">
						<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<Gift className="size-5" />
						</div>
						<div className="min-w-0 space-y-1">
							<h3 className="font-semibold text-base">Your referral link</h3>
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
