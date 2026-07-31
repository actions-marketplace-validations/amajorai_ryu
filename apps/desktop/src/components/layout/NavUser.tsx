import { settingsApi, useSubscription } from "@ryu/settings";
import { Avatar, AvatarFallback, AvatarImage } from "@ryu/ui/components/avatar";
import { NavBeamCta } from "@ryu/ui/components/border-beam";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@ryu/ui/components/context-menu";
import { DitherAvatar } from "@ryu/ui/components/dither-kit/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@ryu/ui/components/dropdown-menu";
import { PlanBadge, type PlanTier } from "@ryu/ui/components/plan-badge";
import { SidebarMenu, SidebarMenuItem } from "@ryu/ui/components/sidebar";
import { toast } from "@ryu/ui/components/sileo";
import { Spinner } from "@ryu/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@ryu/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import {
	ArrowUp,
	ArrowUpRight,
	Check,
	CreditCard,
	EyeOff,
	Laptop,
	LogOut,
	Moon,
	PieChart,
	Plus,
	Settings,
	Sun,
	User,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { useAuthContext } from "@/contexts/auth-context.tsx";
import {
	BACKEND_URL,
	FRONTEND_URL,
	getActiveUserId,
	listAccounts,
	type StoredAccount,
	signOutAccount,
	switchAccount,
	useSession,
} from "@/lib/auth-client.ts";
import { addAccountViaDeviceAuth } from "@/lib/oauth.ts";
import { openExternal } from "@/lib/tauri-bridge.ts";
import { useEntitlementContext } from "@/src/contexts/entitlement-context.tsx";
import { useTabsContext } from "@/src/contexts/TabsContext.tsx";
import { APPROVALS_ALIAS } from "@/src/contributions/companion-alias.ts";
import { useCompanionAlias } from "@/src/contributions/use-companion-alias.ts";
import { useCreditsWallet } from "@/src/hooks/useCreditsWallet.ts";
import { fetchEntitlementStatus } from "@/src/lib/api/billing.ts";
import { formatMicroUsd } from "@/src/lib/api/credits.ts";
import { useSettingsDialog } from "@/src/store/useSettingsDialog.ts";
import { useAppStore } from "../../store/useAppStore.ts";
import { DownloadCenter } from "../downloads/DownloadCenter.tsx";
import { InboxCenter } from "../inbox/InboxCenter.tsx";
import { SettingsDialog } from "../settings/SettingsDialog.tsx";
import { UpdatesSubmenu } from "./UpdatesSubmenu.tsx";

const TRAILING_SLASH_RE = /\/$/;

type FooterChromeKey = "inbox" | "user" | "downloads" | "settings";

/**
 * The plan tier to badge from the entitlement verdict. During the free beta
 * `verdict.plan` is null while `proUnlocked` is true, so we fall back to "pro" —
 * every entitled user wears the Pro mark. A real paid subscription resolves the
 * actual tier (pro/max/teams) on `verdict.plan` instead.
 */
function entitlementBadgeTier(
	verdict: { plan: PlanTier | null; proUnlocked: boolean } | null
): PlanTier | null {
	if (verdict?.plan) {
		return verdict.plan;
	}
	return verdict?.proUnlocked ? "pro" : null;
}

const PLAN_LABELS: Record<string, string> = {
	"desktop-license": "Ryu Desktop",
	pro: "Ryu Pro",
	max: "Ryu Max",
	teams: "Ryu Teams",
};

function planLabel(
	plan: string | null | undefined,
	proUnlocked: boolean
): string {
	if (plan) {
		return PLAN_LABELS[plan] ?? plan;
	}
	return proUnlocked ? "Trial" : "Free";
}

function trialDaysLabel(days: number): string {
	return `${days} day${days === 1 ? "" : "s"} left`;
}

function showTrialCountdown(
	verdict: { reason: string; daysLeftInTrial: number } | null | undefined
): verdict is { reason: "trial"; daysLeftInTrial: number } {
	return verdict?.reason === "trial" && verdict.daysLeftInTrial > 0;
}

// The single next-tier upsell shown in the account menu. Ladder: Free/Trial →
// Pro, Pro/Lifetime → Max, Max → Teams, Teams → nothing (top of the ladder).
// Trial resolves currentPlan to null (proUnlocked, plan null), so it falls to
// the "Upgrade to Pro" default — the conversion pitch the trial should push.
function nextTierLabel(plan: string | null | undefined): string | null {
	if (plan === "teams") {
		return null;
	}
	if (plan === "max") {
		return "Upgrade to Teams";
	}
	if (plan === "pro" || plan === "desktop-license") {
		return "Upgrade to Max";
	}
	return "Upgrade to Pro";
}

function formatDate(value: string | null | undefined): string {
	if (!value) {
		return "Not scheduled";
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "Not scheduled";
	}
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

// Notion-style account switcher: lists every signed-in account (avatar +
// name/email, a check on the active one), switches on click, adds another
// account via the existing device-auth flow, and signs an account out. Tokens
// stay local (the vault in auth-client); this only ever renders the safe fields.
function AccountList() {
	const [accounts, setAccounts] = useState<StoredAccount[]>(() =>
		listAccounts()
	);
	const [activeId, setActiveId] = useState<string | null>(() =>
		getActiveUserId()
	);
	const [adding, setAdding] = useState(false);

	const refresh = () => {
		setAccounts(listAccounts());
		setActiveId(getActiveUserId());
	};

	const handleSwitch = async (userId: string) => {
		if (userId === activeId) {
			return;
		}
		await switchAccount(userId);
		window.location.reload();
	};

	const handleSignOutAccount = async (
		event: React.MouseEvent,
		account: StoredAccount
	) => {
		event.preventDefault();
		event.stopPropagation();
		const wasActive = account.userId === activeId;
		await signOutAccount(account.userId);
		if (wasActive) {
			window.location.reload();
			return;
		}
		refresh();
	};

	const handleAddAccount = () => {
		if (adding) {
			return;
		}
		setAdding(true);
		addAccountViaDeviceAuth(BACKEND_URL, {
			onCode: (info) => {
				openExternal(info.verificationUriComplete).catch(() => undefined);
				toast.show({
					title: "Finish signing in",
					description: `Approve in your browser${
						info.userCode ? ` (code ${info.userCode})` : ""
					} to add the account.`,
				});
			},
			onAdded: () => {
				setAdding(false);
				toast.success("Account added");
				window.location.reload();
			},
			onError: (err) => {
				setAdding(false);
				toast.error({
					title: "Couldn't add account",
					description: err.message,
				});
			},
		});
	};

	return (
		<DropdownMenuGroup>
			{accounts.map((account) => {
				const isActive = account.userId === activeId;
				const label = account.name || account.email || "Account";
				return (
					<DropdownMenuItem
						className="group/item gap-2"
						closeOnClick={false}
						key={account.userId}
						onClick={() => handleSwitch(account.userId)}
					>
						<Avatar className="size-6 shrink-0 rounded-full">
							<AvatarImage
								alt={account.name ?? account.email}
								src={account.image ?? undefined}
							/>
							<AvatarFallback className="overflow-hidden rounded-full bg-transparent p-0">
								<DitherAvatar
									className="size-full"
									name={account.userId ?? account.email ?? "ryu"}
								/>
							</AvatarFallback>
						</Avatar>
						<span className="flex min-w-0 flex-1 flex-col">
							<span className="truncate font-medium text-sm">{label}</span>
							{account.email && account.email !== label ? (
								<span className="truncate text-[11px] text-muted-foreground">
									{account.email}
								</span>
							) : null}
						</span>
						<span className="relative ml-1 flex size-5 shrink-0 items-center justify-center">
							{isActive ? (
								<span className="absolute transition-all duration-150 group-hover/item:scale-50 group-hover/item:opacity-0">
									<Check className="size-4 text-primary" />
								</span>
							) : null}
							<button
								aria-label={`Sign out ${label}`}
								className="absolute flex size-5 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all duration-150 hover:bg-accent hover:text-destructive group-hover/item:scale-100 group-hover/item:opacity-100"
								onClick={(event) => handleSignOutAccount(event, account)}
								type="button"
							>
								<LogOut className="h-3.5 w-3.5" />
							</button>
						</span>
					</DropdownMenuItem>
				);
			})}
			<DropdownMenuItem
				onClick={(event: React.MouseEvent) => {
					event.preventDefault();
					handleAddAccount();
				}}
			>
				{adding ? (
					<Spinner className="mr-2 size-4" />
				) : (
					<Plus className="mr-2 size-4" />
				)}
				Add account
			</DropdownMenuItem>
		</DropdownMenuGroup>
	);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: legacy component
export function NavUser({
	hiddenChrome,
	onHideChrome,
}: {
	hiddenChrome: Set<string>;
	onHideChrome: (key: FooterChromeKey) => void;
}) {
	const { setTheme, resolvedTheme } = useTheme();
	const beamTheme = resolvedTheme === "light" ? "light" : "dark";
	const settingsOpen = useSettingsDialog((s) => s.open);
	const settingsSection = useSettingsDialog((s) => s.section);
	const setSettingsOpen = useSettingsDialog((s) => s.setOpen);
	const openSettings = useSettingsDialog((s) => s.openSettings);
	const { data: session, isPending } = useSession();
	const { verdict } = useEntitlementContext();
	const { openTab } = useTabsContext();
	// Whether ANY enabled app answers to the Inbox path. The tray previews that app's
	// data (pending approvals + quest check-off suggestions) and its every action ends
	// at `/inbox`, so with no owner it is a button that can only ever say "App not
	// enabled". Read from the live contributions feed rather than a baked
	// `com.ryu.approvals`, so this affordance and the route it opens resolve from one
	// source. Approvals ships default-OFF, so on a fresh install this is null.
	const inboxOwner = useCompanionAlias(APPROVALS_ALIAS);
	const badgePlan = entitlementBadgeTier(verdict);
	const { isLifetime } = useSubscription();
	const {
		wallet,
		entitlement,
		loading: creditsLoading,
		error: creditsError,
	} = useCreditsWallet();
	const { data: billingStatus } = useQuery({
		queryKey: ["billing-status-nav"],
		queryFn: fetchEntitlementStatus,
	});
	useAuthContext();
	const isAuthenticated = useAppStore((s) => s.isAuthenticated);
	const oidcUser = useAppStore((s) => s.oidcUser);
	const sessionUser = session?.user;
	const user =
		sessionUser ??
		(oidcUser
			? {
					name: oidcUser.name ?? null,
					email: oidcUser.email ?? null,
					image: oidcUser.picture ?? null,
				}
			: null);

	if (isPending) {
		return (
			<SidebarMenu>
				<SidebarMenuItem>
					<div className="flex h-10 items-center justify-center">
						<Spinner className="size-4" />
					</div>
				</SidebarMenuItem>
			</SidebarMenu>
		);
	}

	if (!(user || isAuthenticated)) {
		return null;
	}

	const showInbox = !hiddenChrome.has("inbox") && inboxOwner !== null;
	const showUser = !hiddenChrome.has("user");
	const showDownloads = !hiddenChrome.has("downloads");
	const showSettings = !hiddenChrome.has("settings");
	if (!(showInbox || showUser || showDownloads || showSettings)) {
		return null;
	}

	const currentPlan = entitlement?.plan ?? verdict?.plan ?? billingStatus?.plan;
	const currentPlanLabel = planLabel(
		currentPlan,
		Boolean(verdict?.proUnlocked)
	);
	const trialCountdown = showTrialCountdown(verdict)
		? trialDaysLabel(verdict.daysLeftInTrial)
		: null;
	const upgradeLabel = nextTierLabel(currentPlan);
	const creditsLeft = (() => {
		if (wallet) {
			return formatMicroUsd(wallet.balanceMicroUsd, wallet.currency);
		}
		if (creditsLoading) {
			return "Loading...";
		}
		if (creditsError) {
			return "Unavailable";
		}
		return "No workspace wallet";
	})();
	const resetDate = formatDate(billingStatus?.subscription?.currentPeriodEnd);
	// Usage-remaining (credits + reset date) is a subscription concept — only
	// surface it for users who actually have a subscription.
	const hasSubscription = Boolean(billingStatus?.subscription);
	const openPricing = () => {
		openExternal(
			`${FRONTEND_URL.replace(TRAILING_SLASH_RE, "")}/pricing`
		).catch(() => undefined);
	};
	const openLifetimeCheckout = async () => {
		try {
			const { url } = await settingsApi.billing.createLifetimeCheckout();
			await openExternal(url);
		} catch {
			toast.error({
				title: "Failed to start checkout",
				description: "Please try again.",
			});
		}
	};

	const upgradeItem = (
		<DropdownMenuItem onClick={openPricing}>
			{upgradeLabel ? (
				<ArrowUpRight className="mr-2 size-4" />
			) : (
				<CreditCard className="mr-2 size-4" />
			)}
			{upgradeLabel ?? "See all plans"}
		</DropdownMenuItem>
	);

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<div className="flex items-center px-1">
					{showUser && (
						<ContextMenu>
							<ContextMenuTrigger>
								<div className="min-w-0 max-w-[160px]">
									<DropdownMenu>
										<DropdownMenuTrigger
											render={
												<button
													className="flex w-full items-center gap-2 rounded-xl py-1.5 pr-2 pl-1 text-left text-sm transition-colors hover:bg-muted"
													type="button"
												/>
											}
										>
											<Avatar className="size-6 shrink-0 rounded-full">
												<AvatarImage
													alt={user?.name ?? ""}
													src={user?.image ?? undefined}
												/>
												<AvatarFallback className="overflow-hidden rounded-full bg-transparent p-0">
													<DitherAvatar
														className="size-full"
														name={
															user?.id ?? user?.email ?? user?.name ?? "ryu"
														}
													/>
												</AvatarFallback>
											</Avatar>
											<span className="min-w-0 flex-1">
												<span className="flex min-w-0 items-center gap-1.5">
													<span className="truncate font-medium text-sm">
														{user?.name ?? "Account"}
													</span>
													<PlanBadge plan={badgePlan} />
												</span>
											</span>
										</DropdownMenuTrigger>
										<DropdownMenuContent
											align="end"
											className="min-w-56"
											side="bottom"
											sideOffset={4}
										>
											<AccountList />
											<DropdownMenuSeparator />
											<DropdownMenuGroup>
												<DropdownMenuItem onClick={() => openTab("/profile")}>
													<User className="mr-2 size-4" />
													Profile
												</DropdownMenuItem>
												<DropdownMenuItem onClick={() => openSettings()}>
													<Settings className="mr-2 size-4" />
													Settings
												</DropdownMenuItem>
												<UpdatesSubmenu />
											</DropdownMenuGroup>
											<DropdownMenuSub>
												<DropdownMenuSubTrigger>
													<Sun className="mr-2 size-4" />
													Theme
												</DropdownMenuSubTrigger>
												<DropdownMenuSubContent>
													<DropdownMenuItem onClick={() => setTheme("light")}>
														<Sun className="mr-2 size-4" />
														Light
													</DropdownMenuItem>
													<DropdownMenuItem onClick={() => setTheme("dark")}>
														<Moon className="mr-2 size-4" />
														Dark
													</DropdownMenuItem>
													<DropdownMenuItem onClick={() => setTheme("system")}>
														<Laptop className="mr-2 size-4" />
														System
													</DropdownMenuItem>
												</DropdownMenuSubContent>
											</DropdownMenuSub>
											<DropdownMenuSeparator />
											<DropdownMenuGroup>
												<DropdownMenuItem disabled>
													<CreditCard className="mr-2 size-4" />
													<span className="flex-1">Plan</span>
													<span className="text-right text-muted-foreground">
														{currentPlanLabel}
														{trialCountdown ? (
															<span className="block text-[11px] tabular-nums">
																{trialCountdown}
															</span>
														) : null}
													</span>
												</DropdownMenuItem>
												{hasSubscription && (
													<DropdownMenuSub>
														<DropdownMenuSubTrigger>
															<PieChart className="mr-2 size-4" />
															Usage remaining
														</DropdownMenuSubTrigger>
														<DropdownMenuSubContent className="min-w-64">
															<div className="space-y-3 px-3 py-2">
																<div>
																	<p className="text-muted-foreground text-xs">
																		Credits left for workspace
																	</p>
																	<p className="font-semibold text-sm">
																		{creditsLeft}
																	</p>
																</div>
																<div>
																	<p className="text-muted-foreground text-xs">
																		Reset date
																	</p>
																	<p className="font-semibold text-sm">
																		{resetDate}
																	</p>
																</div>
															</div>
														</DropdownMenuSubContent>
													</DropdownMenuSub>
												)}
												{upgradeLabel === "Upgrade to Pro" ? (
													<NavBeamCta theme={beamTheme} variant="pulse">
														{upgradeItem}
													</NavBeamCta>
												) : (
													upgradeItem
												)}
												{!isLifetime && (
													<NavBeamCta theme={beamTheme} variant="rotate">
														<DropdownMenuItem onClick={openLifetimeCheckout}>
															<ArrowUp className="mr-2 size-4" />
															Get Lifetime Access
														</DropdownMenuItem>
													</NavBeamCta>
												)}
											</DropdownMenuGroup>
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
							</ContextMenuTrigger>
							<ContextMenuContent>
								<ContextMenuItem onClick={() => onHideChrome("user")}>
									<EyeOff className="mr-2 size-4" />
									Hide account
								</ContextMenuItem>
							</ContextMenuContent>
						</ContextMenu>
					)}

					<div className="ml-auto flex items-center gap-0.5">
						{/* Create menu ("+") temporarily hidden per request. Restore by
						    re-adding the CreateMenu import and <CreateMenu /> here. */}
						{showInbox && (
							<ContextMenu>
								<ContextMenuTrigger>
									<InboxCenter />
								</ContextMenuTrigger>
								<ContextMenuContent>
									<ContextMenuItem onClick={() => onHideChrome("inbox")}>
										<EyeOff className="mr-2 size-4" />
										Hide inbox
									</ContextMenuItem>
								</ContextMenuContent>
							</ContextMenu>
						)}
						{showDownloads && (
							<ContextMenu>
								<ContextMenuTrigger>
									<DownloadCenter />
								</ContextMenuTrigger>
								<ContextMenuContent>
									<ContextMenuItem onClick={() => onHideChrome("downloads")}>
										<EyeOff className="mr-2 size-4" />
										Hide downloads
									</ContextMenuItem>
								</ContextMenuContent>
							</ContextMenu>
						)}
						{showSettings && (
							<ContextMenu>
								<ContextMenuTrigger>
									<Tooltip>
										<TooltipTrigger
											render={
												<button
													aria-label="Settings"
													className="gooey-tap flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
													onClick={() => openSettings()}
													type="button"
												>
													<Settings className="size-4" />
												</button>
											}
										/>
										<TooltipContent>Settings</TooltipContent>
									</Tooltip>
								</ContextMenuTrigger>
								<ContextMenuContent>
									<ContextMenuItem onClick={() => onHideChrome("settings")}>
										<EyeOff className="mr-2 size-4" />
										Hide settings
									</ContextMenuItem>
								</ContextMenuContent>
							</ContextMenu>
						)}
					</div>
				</div>
				<SettingsDialog
					defaultSection={settingsSection}
					onOpenChange={setSettingsOpen}
					open={settingsOpen}
				/>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
