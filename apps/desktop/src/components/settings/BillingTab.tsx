import { Share08Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	DESKTOP_TRIAL_INCLUDES,
	DESKTOP_TRIAL_LABEL,
} from "@ryu/auth/lib/plans";
import { settingsApi, useSubscription } from "@ryu/settings";
import { Button } from "@ryu/ui/components/button";
import { Input } from "@ryu/ui/components/input";
import { Label } from "@ryu/ui/components/label";
import type { PlanTier } from "@ryu/ui/components/plan-badge";
import { PlanBadge } from "@ryu/ui/components/plan-badge";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select";
import { toast } from "@ryu/ui/components/sileo";
import { Spinner } from "@ryu/ui/components/spinner";
import { Switch } from "@ryu/ui/components/switch";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { sileo } from "sileo";
import { openExternal } from "@/lib/tauri-bridge.ts";
import { useEntitlementContext } from "@/src/contexts/entitlement-context.tsx";
import { useCreditsWallet } from "@/src/hooks/useCreditsWallet.ts";
import { type ApiTarget, toTarget } from "@/src/lib/api/client.ts";
import {
	type AutoTopupSettings,
	type CreditAlertRecipients,
	fetchAutoTopup,
	fetchCreditAlert,
	formatMicroUsd,
	MAX_TOPUP_DOLLARS,
	MIN_TOPUP_DOLLARS,
	putAutoTopup,
	putCreditAlert,
} from "@/src/lib/api/credits.ts";
import { useActiveOrgId } from "@/src/lib/api/orgs.ts";
import {
	getSandboxDefaultRunBudgetMicroUsd,
	setSandboxDefaultRunBudgetMicroUsd,
} from "@/src/lib/api/preferences.ts";
import { formatDate } from "@/src/lib/timezone.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import {
	SettingsCard,
	SettingsGroup,
	SettingsItem,
	SettingsSection,
} from "./shared/settings-items.tsx";

function activeTarget(): ApiTarget {
	return toTarget(useNodeStore.getState().getActiveNode());
}

/** Micro-USD per US dollar (the wallet + budget base unit). */
const MICRO_USD_PER_DOLLAR = 1_000_000;

const centsToDollarText = (cents: number): string => String(cents / 100);

const dollarTextToCents = (text: string): number => {
	const value = Number.parseFloat(text);
	return Number.isFinite(value) ? Math.round(value * 100) : 0;
};

const microToDollarText = (micro: number): string =>
	String(micro / MICRO_USD_PER_DOLLAR);

const dollarTextToMicro = (text: string): number => {
	const value = Number.parseFloat(text);
	return Number.isFinite(value) ? Math.round(value * MICRO_USD_PER_DOLLAR) : 0;
};

const errorText = (e: unknown): string =>
	e instanceof Error ? e.message : "Something went wrong. Please try again.";

const ALERT_RECIPIENT_OPTIONS: {
	value: CreditAlertRecipients;
	label: string;
}[] = [
	{ value: "none", label: "No one (off)" },
	{ value: "owners", label: "Owners only" },
	{ value: "owners_admins", label: "Owners and admins" },
];

/**
 * What an org with NO saved low-balance alert reads as. Named rather than
 * inlined twice because it is used for the initial mount AND for the reset that
 * every workspace switch performs — the two must not drift, or a switch would
 * land somewhere the first paint never does.
 */
const ALERT_DEFAULTS = {
	recipients: "none" as CreditAlertRecipients,
	thresholdText: "5",
};

/**
 * Low-balance email alert card. Emails the org's owners (or owners+admins) when
 * the managed wallet balance drops below a threshold. Independent of auto-recharge
 * (no saved card needed): `recipients: "none"` is the off state. Admin-only on
 * the server; a non-admin's save surfaces a 403 toast.
 */
function LowBalanceAlertCard() {
	const { authed } = useCreditsWallet();
	const activeOrgId = useActiveOrgId();
	const [recipients, setRecipients] = useState<CreditAlertRecipients>(
		ALERT_DEFAULTS.recipients
	);
	const [thresholdText, setThresholdText] = useState(
		ALERT_DEFAULTS.thresholdText
	);
	const [lastError, setLastError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [loadingSettings, setLoadingSettings] = useState(false);

	useEffect(() => {
		// CLEAR FIRST, THEN LOAD. `activeOrgId` is a RE-RUN key, not an argument:
		// the alert config is stored per org and `/api/credits/alert` resolves that
		// org from the session, so switching workspace changes the answer without
		// changing the request. This card is plain state rather than a query, so
		// the switcher's cache invalidation cannot reach it — the dependency is
		// what reloads it.
		//
		// The reset is the load-bearing half. Every path out of the fetch below can
		// decline to set state — `fetchCreditAlert` resolves to NULL when the org
		// has no alert row, and the `.catch` covers a 403 in an org where the user
		// is not an admin — and without this the card would keep rendering the
		// PREVIOUS org's recipients and threshold as if they were this org's. Worse
		// than a stale read: `handleThresholdBlur` would then commit that mixture,
		// writing the old org's threshold onto the new org's alert.
		setRecipients(ALERT_DEFAULTS.recipients);
		setThresholdText(ALERT_DEFAULTS.thresholdText);
		setLastError(null);
		if (!authed) {
			return;
		}
		let cancelled = false;
		setLoadingSettings(true);
		fetchCreditAlert()
			.then((s) => {
				if (cancelled || !s) {
					return;
				}
				setRecipients(s.recipients);
				// A stored 0 means "never configured", so the DEFAULT above stands —
				// deliberately not the value that was on screen a moment ago.
				if (s.thresholdCents > 0) {
					setThresholdText(centsToDollarText(s.thresholdCents));
				}
				setLastError(s.lastError);
			})
			.catch(() => undefined)
			.finally(() => {
				if (!cancelled) {
					setLoadingSettings(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [authed, activeOrgId]);

	const commit = useCallback(
		async (nextRecipients: CreditAlertRecipients): Promise<boolean> => {
			const thresholdCents = dollarTextToCents(thresholdText);
			if (nextRecipients !== "none" && thresholdCents <= 0) {
				toast.error("Set a balance threshold above $0.");
				return false;
			}
			setSaving(true);
			try {
				const result = await putCreditAlert({
					recipients: nextRecipients,
					thresholdCents,
				});
				if (result) {
					setRecipients(result.recipients);
					setLastError(result.lastError);
				}
				return true;
			} catch (e) {
				toast.error(errorText(e));
				return false;
			} finally {
				setSaving(false);
			}
		},
		[thresholdText]
	);

	const handleRecipientsChange = useCallback(
		(next: CreditAlertRecipients) => {
			const previous = recipients;
			setRecipients(next);
			commit(next)
				.then((ok) => {
					if (!ok) {
						setRecipients(previous);
					}
				})
				.catch(() => setRecipients(previous));
		},
		[recipients, commit]
	);

	const handleThresholdBlur = useCallback(() => {
		if (recipients !== "none") {
			commit(recipients).catch(() => undefined);
		}
	}, [recipients, commit]);

	// Locked while the new org's row is in flight as well as while saving: the
	// fields are showing defaults at that moment, and a save from them would
	// write those defaults onto whichever org is now active.
	const fieldsDisabled = !authed || saving || loadingSettings;
	const off = recipients === "none";

	return (
		<SettingsSection
			caption="Email your org's owners or admins when the managed balance runs low, so a top-up happens before runs stall. Only an org admin can change this."
			title="Low balance alert"
		>
			<SettingsCard className="space-y-4">
				<div className="grid gap-4 sm:grid-cols-2">
					<div className="space-y-1.5">
						<Label htmlFor="credit-alert-recipients">Email</Label>
						<Select
							disabled={fieldsDisabled}
							items={ALERT_RECIPIENT_OPTIONS}
							onValueChange={(v) =>
								handleRecipientsChange(v as CreditAlertRecipients)
							}
							value={recipients}
						>
							<SelectTrigger
								className="h-8 w-full text-sm"
								id="credit-alert-recipients"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{ALERT_RECIPIENT_OPTIONS.map((opt) => (
									<SelectItem key={opt.value} value={opt.value}>
										{opt.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="credit-alert-threshold">
							When balance falls below
						</Label>
						<div className="flex items-center gap-2">
							<span className="text-muted-foreground text-sm">$</span>
							<Input
								className="h-8"
								disabled={fieldsDisabled || off}
								id="credit-alert-threshold"
								min={0}
								onBlur={handleThresholdBlur}
								onChange={(e) => setThresholdText(e.target.value)}
								step="1"
								type="number"
								value={thresholdText}
							/>
						</div>
					</div>
				</div>
				{lastError ? (
					<p className="text-destructive text-xs">
						Last alert email failed: {lastError}
					</p>
				) : null}
			</SettingsCard>
		</SettingsSection>
	);
}

/**
 * Desktop trial + license access (epic #496, Unit C1). Surfaces the trial
 * countdown, the resolved access state, and a "manage license/upgrade" action.
 * Reads the reliable bearer-authed entitlement verdict (NOT the cookie-based
 * useSubscription, which silently fails in the Tauri webview).
 */
function DesktopAccessSection() {
	const { ready, verdict, requestUpgrade } = useEntitlementContext();
	if (!(ready && verdict)) {
		return (
			<SettingsSection title="Desktop access">
				<SettingsCard>
					<Spinner className="size-4" />
				</SettingsCard>
			</SettingsSection>
		);
	}

	const reasonLabel: Record<typeof verdict.reason, string> = {
		subscription: "Active subscription",
		license: "Licensed",
		beta: "Free during beta",
		// Not a "Pro trial": the trial grants Band 2 only — see
		// `DESKTOP_TRIAL_LABEL` in `@ryu/auth/lib/plans`.
		trial: `${DESKTOP_TRIAL_LABEL} — ${verdict.daysLeftInTrial} day${
			verdict.daysLeftInTrial === 1 ? "" : "s"
		} left`,
		"offline-grace": "Active (offline)",
		"trial-expired": `${DESKTOP_TRIAL_LABEL} ended`,
		locked: "Free (local only)",
	};

	return (
		<SettingsSection title="Desktop access">
			<SettingsGroup>
				<SettingsItem
					actions={
						verdict.paywalled ? (
							<Button onClick={requestUpgrade} size="sm">
								Unlock Pro
							</Button>
						) : undefined
					}
					description={
						verdict.paywalled
							? "Basic local chat stays free. Unlock Pro features and cloud models that run for you."
							: verdict.reason === "trial"
								? DESKTOP_TRIAL_INCLUDES
								: verdict.reason === "beta"
									? "Ryu is free for everyone during the beta. Enjoy full Pro features."
									: "Pro features are unlocked."
					}
					title={
						<span className="flex items-center gap-2">
							<PlanBadge plan={verdict.proUnlocked ? "pro" : null} />
							<span className="font-normal text-muted-foreground text-xs">
								{reasonLabel[verdict.reason]}
							</span>
						</span>
					}
				/>
			</SettingsGroup>
		</SettingsSection>
	);
}

const AUTOTOPUP_MIN_CENTS = MIN_TOPUP_DOLLARS * 100;
const AUTOTOPUP_MAX_CENTS = MAX_TOPUP_DOLLARS * 100;

/**
 * What an org with NO auto-recharge record reads as — the same values the card
 * mounts with. Named for the same reason as {@link ALERT_DEFAULTS}: the mount
 * and the per-switch reset must land in the identical place.
 */
const AUTOTOPUP_DEFAULTS = {
	capText: "0",
	enabled: false,
	thresholdText: centsToDollarText(AUTOTOPUP_MIN_CENTS),
	topupText: centsToDollarText(AUTOTOPUP_MIN_CENTS * 2),
};

/**
 * Spend controls (sandbox metering & billing rail, area E). Shows the live
 * wallet balance, an "Automatic recharge" card (off-session Polar top-up when the
 * balance runs low, bounded by an optional monthly cap), and the per-run default
 * sandbox budget. Auto-recharge is a control-plane concern (`/api/credits/autotopup`,
 * bearer-authed, admin-only to change); the sandbox budget is a Core node
 * preference ("what runs"), written here and read by Core per run.
 */
function SpendControlsSection() {
	const {
		wallet,
		authed,
		loading: walletLoading,
		refresh: refreshWallet,
	} = useCreditsWallet();
	const activeOrgId = useActiveOrgId();

	const [settings, setSettings] = useState<AutoTopupSettings | null>(null);
	const [enabled, setEnabled] = useState(AUTOTOPUP_DEFAULTS.enabled);
	const [thresholdText, setThresholdText] = useState(
		AUTOTOPUP_DEFAULTS.thresholdText
	);
	const [topupText, setTopupText] = useState(AUTOTOPUP_DEFAULTS.topupText);
	const [capText, setCapText] = useState(AUTOTOPUP_DEFAULTS.capText);
	const [saving, setSaving] = useState(false);
	const [loadingSettings, setLoadingSettings] = useState(false);
	const [portalPending, setPortalPending] = useState(false);

	const [budgetText, setBudgetText] = useState("0");

	// Load the org's auto-recharge settings (control plane). A non-authed user has
	// no wallet to recharge, so skip the fetch and leave the defaults in place.
	//
	// CLEAR FIRST, THEN LOAD. `activeOrgId` is a re-run key for the same reason as
	// the alert card above: auto-recharge is stored per org, resolved from the
	// session, and this card holds it in plain state that no cache invalidation
	// can reach. The reset in front of the fetch is what makes that re-run mean
	// anything — BOTH paths out of the fetch can decline to set state
	// (`fetchAutoTopup` resolves to NULL for an org that never configured
	// auto-recharge, and the `.catch` covers a 403 for a non-admin / offline), so
	// without it the card would assert the previous org's ON switch and amounts
	// over an org that has no record at all. And `handleFieldBlur` would then POST
	// that record — including `settings?.cooldownSec`, which is why `settings`
	// itself must be cleared too — silently ENABLING auto-recharge on the new org.
	useEffect(() => {
		setSettings(null);
		setEnabled(AUTOTOPUP_DEFAULTS.enabled);
		setThresholdText(AUTOTOPUP_DEFAULTS.thresholdText);
		setTopupText(AUTOTOPUP_DEFAULTS.topupText);
		setCapText(AUTOTOPUP_DEFAULTS.capText);
		if (!authed) {
			return;
		}
		let cancelled = false;
		setLoadingSettings(true);
		fetchAutoTopup()
			.then((s) => {
				if (cancelled || !s) {
					return;
				}
				setSettings(s);
				setEnabled(s.enabled);
				setThresholdText(
					centsToDollarText(s.thresholdCents || AUTOTOPUP_MIN_CENTS)
				);
				setTopupText(
					centsToDollarText(s.amountCents || AUTOTOPUP_MIN_CENTS * 2)
				);
				setCapText(centsToDollarText(s.monthlyCapCents));
			})
			.catch(() => {
				// A load failure (offline / no org) just leaves the defaults reset
				// above; the user can still see the card. Saves surface their own toast.
			})
			.finally(() => {
				if (!cancelled) {
					setLoadingSettings(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [authed, activeOrgId]);

	// The balance printed below comes from `useCreditsWallet`, which is also plain
	// state — and its own load effect has no active-org dependency, so it is
	// frozen to whichever org was active when it first ran. Re-pull it here on a
	// switch, or this card keeps showing the previous workspace's money next to
	// the new workspace's recharge settings.
	//
	// Deliberately a LOCAL re-pull and not the single-point fix: the same hook
	// backs the nav-user chip, the credits page, the node selector and onboarding,
	// all of which stay stale until the hook keys its own load on the active org.
	useEffect(() => {
		if (!activeOrgId) {
			return;
		}
		refreshWallet().catch(() => undefined);
	}, [activeOrgId, refreshWallet]);

	// Load the per-run default sandbox budget (Core node preference).
	useEffect(() => {
		let cancelled = false;
		getSandboxDefaultRunBudgetMicroUsd(activeTarget())
			.then((micro) => {
				if (!cancelled) {
					setBudgetText(microToDollarText(micro));
				}
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	// Persist the auto-recharge settings. Enabling validates the amounts (mirroring
	// the server's $5–$1000 bounds) before the call so bad input never reaches
	// Polar; returns whether the save succeeded so the toggle can roll back.
	const commit = useCallback(
		async (nextEnabled: boolean): Promise<boolean> => {
			const amountCents = dollarTextToCents(topupText);
			const thresholdCents = dollarTextToCents(thresholdText);
			const monthlyCapCents = Math.max(0, dollarTextToCents(capText));
			if (nextEnabled) {
				if (
					amountCents < AUTOTOPUP_MIN_CENTS ||
					amountCents > AUTOTOPUP_MAX_CENTS
				) {
					toast.error(
						`Recharge amount must be between $${MIN_TOPUP_DOLLARS} and $${MAX_TOPUP_DOLLARS}.`
					);
					return false;
				}
				if (thresholdCents <= 0) {
					toast.error("Set a balance threshold above $0.");
					return false;
				}
			}
			setSaving(true);
			try {
				const result = await putAutoTopup({
					enabled: nextEnabled,
					amountCents,
					thresholdCents,
					monthlyCapCents,
					cooldownSec: settings?.cooldownSec,
				});
				if (result) {
					setSettings(result);
					setEnabled(result.enabled);
				} else {
					setEnabled(nextEnabled);
				}
				return true;
			} catch (e) {
				toast.error(errorText(e));
				return false;
			} finally {
				setSaving(false);
			}
		},
		[topupText, thresholdText, capText, settings]
	);

	const handleToggle = useCallback(
		(next: boolean) => {
			const previous = enabled;
			setEnabled(next);
			commit(next)
				.then((ok) => {
					if (!ok) {
						setEnabled(previous);
					}
				})
				.catch(() => setEnabled(previous));
		},
		[enabled, commit]
	);

	// Only persist edits while enabled — the server stores amounts on the enabled
	// record, so a disabled card keeps the edits locally until it is turned on.
	const handleFieldBlur = useCallback(() => {
		if (enabled) {
			commit(true).catch(() => undefined);
		}
	}, [enabled, commit]);

	const handleManagePayment = useCallback(async () => {
		setPortalPending(true);
		try {
			const { url } = await settingsApi.billing.getPortalUrl();
			await openExternal(url);
		} catch {
			toast.error("Couldn't open the billing portal. Please try again.");
		} finally {
			setPortalPending(false);
		}
	}, []);

	const saveBudget = useCallback(async () => {
		const micro = Math.max(0, dollarTextToMicro(budgetText));
		setBudgetText(microToDollarText(micro));
		const ok = await setSandboxDefaultRunBudgetMicroUsd(activeTarget(), micro);
		if (!ok) {
			toast.error("Couldn't save the sandbox run budget.");
		}
	}, [budgetText]);

	// WHOSE money is on screen — answered by the wallet the server handed back,
	// not by a local "the re-pull finished" marker. `/api/credits/wallet` always
	// returns the ACTIVE ORG's wallet (`ownerType: "org"`, `ownerId` = that org),
	// so the record carries its own provenance and the check cannot drift from it.
	//
	// A marker would lie on exactly the path this card must not lie on:
	// `useCreditsWallet.refresh` records a failed fetch in its `error` and
	// RESOLVES rather than rejecting, so a `.then()` after the re-pull runs even
	// when the new org's wallet 403'd (non-admin) or never arrived (offline) —
	// leaving the PREVIOUS org's balance on screen while the marker claimed the
	// new one. Comparing ids means a failed re-pull simply leaves the number
	// unclaimed, and the card prints "…".
	//
	// It covers the live stream too: `useWalletStream` opens once per mount and
	// stays scoped to the org it connected as, but its frames are MERGED into the
	// wallet in hand, so a post-switch push keeps the old `ownerId` and stays
	// correctly disowned here.
	//
	// `activeOrgId` null is not that case: a session with no active org resolves
	// server-side to the earliest membership, and the wallet already reflects it.
	// Nor is "no wallet yet" — that is the load/error state below, not another
	// org's money.
	const walletIsOtherOrg =
		Boolean(activeOrgId) && Boolean(wallet) && wallet?.ownerId !== activeOrgId;

	let balanceLabel = "—";
	if (!authed) {
		balanceLabel = "Sign in";
	} else if (walletIsOtherOrg || (walletLoading && !wallet)) {
		balanceLabel = "…";
	} else if (wallet) {
		balanceLabel = formatMicroUsd(wallet.balanceMicroUsd, wallet.currency);
	}

	// Locked while this org's record is in flight as well as while saving: the
	// fields are showing defaults then, and a save from them would write those
	// defaults — and an `enabled: true` — onto whichever org is now active.
	const fieldsDisabled = !authed || saving || loadingSettings;

	return (
		<>
			<SettingsSection
				caption="Ryu tops up your balance automatically so managed runs never stall for lack of credit. Recharges are charged to your saved card via Polar and only an org admin can change these."
				title="Automatic recharge"
			>
				<SettingsCard className="space-y-4">
					<div className="flex items-center justify-between gap-4">
						<div>
							<p className="font-medium text-sm">Current balance</p>
							<p className="text-muted-foreground text-xs">
								Your org's spendable credit.
							</p>
						</div>
						<span className="font-medium text-sm tabular-nums">
							{balanceLabel}
						</span>
					</div>

					<div className="flex items-center justify-between gap-4">
						<div>
							<p className="font-medium text-sm">Automatic recharge</p>
							<p className="text-muted-foreground text-xs">
								Top up automatically when your balance runs low.
							</p>
						</div>
						<Switch
							aria-label="Automatic recharge"
							checked={enabled}
							disabled={fieldsDisabled}
							onCheckedChange={(v) => handleToggle(Boolean(v))}
						/>
					</div>

					<div className="grid gap-4 sm:grid-cols-3">
						<div className="space-y-1.5">
							<Label htmlFor="autotopup-threshold">
								When balance falls below
							</Label>
							<div className="flex items-center gap-2">
								<span className="text-muted-foreground text-sm">$</span>
								<Input
									className="h-8"
									disabled={fieldsDisabled}
									id="autotopup-threshold"
									min={0}
									onBlur={handleFieldBlur}
									onChange={(e) => setThresholdText(e.target.value)}
									step="1"
									type="number"
									value={thresholdText}
								/>
							</div>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="autotopup-amount">Automatically add</Label>
							<div className="flex items-center gap-2">
								<span className="text-muted-foreground text-sm">$</span>
								<Input
									className="h-8"
									disabled={fieldsDisabled}
									id="autotopup-amount"
									max={MAX_TOPUP_DOLLARS}
									min={MIN_TOPUP_DOLLARS}
									onBlur={handleFieldBlur}
									onChange={(e) => setTopupText(e.target.value)}
									step="1"
									type="number"
									value={topupText}
								/>
							</div>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="autotopup-cap">Monthly recharge limit</Label>
							<div className="flex items-center gap-2">
								<span className="text-muted-foreground text-sm">$</span>
								<Input
									className="h-8"
									disabled={fieldsDisabled}
									id="autotopup-cap"
									min={0}
									onBlur={handleFieldBlur}
									onChange={(e) => setCapText(e.target.value)}
									placeholder="0 = no limit"
									step="1"
									type="number"
									value={capText}
								/>
							</div>
						</div>
					</div>

					<div className="flex items-center justify-between gap-4 border-border/50 border-t pt-3">
						<div>
							<p className="font-medium text-sm">Payment method</p>
							<p className="text-muted-foreground text-xs">
								Recharges use your saved card. If you have no card yet, make one
								manual top-up first.
							</p>
						</div>
						<Button
							disabled={portalPending}
							onClick={handleManagePayment}
							size="sm"
							variant="ghost"
						>
							{portalPending ? (
								<Spinner className="mr-2 size-3.5" />
							) : (
								<HugeiconsIcon className="mr-2 size-3.5" icon={Share08Icon} />
							)}
							Manage
						</Button>
					</div>
				</SettingsCard>
			</SettingsSection>

			<LowBalanceAlertCard />

			<SettingsSection
				caption="The most a single sandboxed run may cost before Ryu stops it and tears the workspace down. Applies to sandboxed runs on this node. Set $0 for no per-run limit."
				title="Sandbox spending"
			>
				<SettingsCard>
					<div className="flex items-center justify-between gap-4">
						<div>
							<p className="font-medium text-sm">Default run budget</p>
							<p className="text-muted-foreground text-xs">
								Per-run execution cap for sandboxed agent runs.
							</p>
						</div>
						<div className="flex items-center gap-2">
							<span className="text-muted-foreground text-sm">$</span>
							<Input
								aria-label="Default sandbox run budget"
								className="h-8 w-28"
								min={0}
								onBlur={saveBudget}
								onChange={(e) => setBudgetText(e.target.value)}
								placeholder="0"
								step="0.01"
								type="number"
								value={budgetText}
							/>
						</div>
					</div>
				</SettingsCard>
			</SettingsSection>
		</>
	);
}

export function BillingTab() {
	const {
		hasProSubscription,
		isTrialing,
		daysLeftInTrial,
		isLifetime,
		lifetime,
		planInterval,
		isLoading: subLoading,
	} = useSubscription();

	const activeOrgId = useActiveOrgId();

	const [pendingAction, setPendingAction] = useState<
		"manage" | "lifetime" | null
	>(null);

	const { data: invoicesData, isLoading: invoicesLoading } = useQuery({
		// Keyed on the active org even though the request carries no org: invoices
		// are billed to the org the session is scoped to, so without the id in the
		// key the previous workspace's invoices are served from cache for a paint
		// after a switch, before the invalidation's refetch lands.
		queryKey: ["billing-invoices", activeOrgId],
		queryFn: settingsApi.billing.getInvoices,
	});

	const plan: PlanTier | null = isLifetime
		? "desktop-license"
		: isTrialing
			? "pro"
			: hasProSubscription
				? "pro"
				: null;

	const handleManageSubscription = async () => {
		setPendingAction("manage");
		try {
			const { url } = await settingsApi.billing.getPortalUrl();
			await openExternal(url);
		} catch {
			sileo.error({
				title: "Failed to open subscription portal. Please try again.",
			});
		} finally {
			setPendingAction(null);
		}
	};

	const handleLifetimeCheckout = async () => {
		setPendingAction("lifetime");
		try {
			const { url } = await settingsApi.billing.createLifetimeCheckout();
			await openExternal(url);
		} catch {
			sileo.error({ title: "Failed to open checkout. Please try again." });
		} finally {
			setPendingAction(null);
		}
	};

	const lifetimePending = pendingAction === "lifetime";

	return (
		<div className="space-y-6">
			<DesktopAccessSection />
			<SettingsSection title="Current plan">
				{subLoading ? (
					<SettingsCard>
						<Spinner className="size-4" />
					</SettingsCard>
				) : (
					<SettingsGroup>
						<SettingsItem
							actions={
								hasProSubscription && !isLifetime ? (
									<Button
										disabled={pendingAction === "manage"}
										onClick={handleManageSubscription}
										size="sm"
										variant="ghost"
									>
										{pendingAction === "manage" ? (
											<Spinner className="mr-2 size-3.5" />
										) : (
											<HugeiconsIcon
												className="mr-2 size-3.5"
												icon={Share08Icon}
											/>
										)}
										Manage subscription
									</Button>
								) : undefined
							}
							title={
								<span className="flex flex-col gap-1.5">
									<PlanBadge plan={plan} />
									{hasProSubscription && !isLifetime && !isTrialing && (
										<span className="font-normal text-muted-foreground text-xs">
											{planInterval === "month"
												? "Monthly subscription"
												: "Annual subscription"}
										</span>
									)}
									{isTrialing && (
										<span className="font-normal text-muted-foreground text-xs">
											You&apos;re on a free trial.{" "}
											{planInterval
												? `Billed ${planInterval}ly after trial ends.`
												: ""}
										</span>
									)}
									{isTrialing && daysLeftInTrial > 0 && (
										<span className="font-medium text-destructive text-xs">
											Trial ends in {daysLeftInTrial} day
											{daysLeftInTrial === 1 ? "" : "s"}
										</span>
									)}
								</span>
							}
						/>
					</SettingsGroup>
				)}
			</SettingsSection>

			<SpendControlsSection />

			<SettingsSection title="Lifetime access">
				{subLoading ? (
					<SettingsCard>
						<Spinner className="size-4" />
					</SettingsCard>
				) : (
					<SettingsGroup>
						<SettingsItem
							actions={
								<Button
									className="shrink-0"
									disabled={lifetimePending}
									onClick={handleLifetimeCheckout}
									size="sm"
									variant={isLifetime ? "outline" : "default"}
								>
									{lifetimePending ? (
										<Spinner className="mr-2 size-3.5" />
									) : (
										<HugeiconsIcon
											className="mr-2 size-3.5"
											icon={Share08Icon}
										/>
									)}
									{isLifetime
										? lifetime?.expired
											? "Renew — buy lifetime again"
											: "Extend — buy lifetime again"
										: "Get lifetime access"}
								</Button>
							}
							description={
								isLifetime && lifetime ? (
									<>
										Updates included until{" "}
										{formatDate(lifetime.updatesExpiresAt, {
											year: "numeric",
											month: "long",
											day: "numeric",
										})}
										{lifetime.expired && (
											<span className="mt-1 block font-medium text-destructive">
												Updates expired. Buy lifetime access again at the
												current price to extend them.
											</span>
										)}
									</>
								) : (
									"Pay once, own it forever. Includes 1 year of updates."
								)
							}
							title="Lifetime"
						/>
					</SettingsGroup>
				)}
			</SettingsSection>

			<SettingsSection title="Invoice history">
				{invoicesLoading ? (
					<SettingsCard>
						<Spinner className="size-4" />
					</SettingsCard>
				) : invoicesData?.invoices?.length ? (
					<SettingsGroup>
						{invoicesData.invoices.map((invoice) => (
							<SettingsItem
								actions={
									<span className="font-medium text-sm">
										{(invoice.amount / 100).toLocaleString(undefined, {
											style: "currency",
											currency: invoice.currency.toUpperCase(),
										})}
									</span>
								}
								description={
									<span className="capitalize">{invoice.status}</span>
								}
								key={invoice.id}
								title={formatDate(invoice.createdAt, {
									year: "numeric",
									month: "short",
									day: "numeric",
								})}
							/>
						))}
					</SettingsGroup>
				) : (
					<p className="px-3 text-muted-foreground text-sm">No invoices yet.</p>
				)}
			</SettingsSection>
		</div>
	);
}
