"use client";

import {
	Delete02Icon,
	SquareLock01Icon,
	Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@ryu/ui/components/button.tsx";
import { CommandItem } from "@ryu/ui/components/command.tsx";
import {
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@ryu/ui/components/dropdown-menu.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";
import { useProviderCommandNavigation } from "@/components/agent-elements/input/provider-command-dialog.tsx";

/** A provider or ACP account as exposed by Core — labels only, never credentials. */
export interface ProviderAccount {
	accountId: string;
	/** Whether this is the account used by the current Ryu configuration. */
	active: boolean;
	/** Whether this account is the selected BYOK account for the Gateway. */
	gatewayActive?: boolean;
	/** "api_key" | "oauth" | "opaque". */
	kind: string;
	/** Display name (email, provider label, or "Account N"). */
	label: string;
	/** Provider id for managed-Pi accounts aggregated under the Ryu agent. */
	provider?: string;
}

export type ProviderAccountTarget = "gateway" | "self";

interface AccountTargetItemProps {
	description: string;
	disabled?: boolean;
	isActive: boolean;
	label: string;
	onSelect: () => void;
}

function AccountTargetItem({
	disabled = false,
	isActive,
	description,
	label,
	onSelect,
}: AccountTargetItemProps) {
	const commandNavigation = useProviderCommandNavigation();
	if (commandNavigation) {
		return (
			<CommandItem
				data-checked={isActive}
				disabled={disabled}
				onSelect={() => {
					if (disabled) {
						return;
					}
					onSelect();
					commandNavigation.close();
				}}
			>
				<span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
					<span className="truncate">{label}</span>
					<span className="font-normal text-muted-foreground text-xs">
						{description}
					</span>
				</span>
			</CommandItem>
		);
	}

	return (
		<DropdownMenuItem
			className="flex-col items-start gap-0.5"
			disabled={disabled}
			onClick={onSelect}
		>
			<span className="flex w-full items-center gap-2">
				<span className="flex-1 truncate">{label}</span>
				{isActive && (
					<HugeiconsIcon
						className="shrink-0 text-muted-foreground"
						icon={Tick02Icon}
						size={14}
						strokeWidth={2}
					/>
				)}
			</span>
			<span className="w-full truncate text-left font-normal text-muted-foreground text-xs">
				{description}
			</span>
		</DropdownMenuItem>
	);
}

function AccountTargetPage({
	account,
	canSetGateway,
	gatewaySupported,
	onSwitch,
}: {
	account: ProviderAccount;
	canSetGateway: boolean;
	gatewaySupported: boolean;
	onSwitch: (account: ProviderAccount, target: ProviderAccountTarget) => void;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			<AccountTargetItem
				description="Switch the account used by your Ryu session."
				isActive={account.active}
				label="Use for yourself"
				onSelect={() => onSwitch(account, "self")}
			/>
			{gatewaySupported && (
				<AccountTargetItem
					description={
						canSetGateway
							? "Make this the shared Gateway account for this provider."
							: "Requires the gateway.configure admin permission."
					}
					disabled={!canSetGateway}
					isActive={account.gatewayActive === true}
					label={
						canSetGateway ? "Set for Gateway" : "Set for Gateway (admin only)"
					}
					onSelect={() => onSwitch(account, "gateway")}
				/>
			)}
		</div>
	);
}

function AccountStatus({ account }: { account: ProviderAccount }) {
	const gatewayActive = account.kind === "api_key" && account.gatewayActive;
	const statuses = [
		account.active ? "You" : null,
		gatewayActive ? "Gateway" : null,
	].filter(Boolean);
	if (statuses.length === 0) {
		return null;
	}
	return (
		<span className="shrink-0 text-[10px] text-muted-foreground">
			{statuses.join(" · ")}
		</span>
	);
}

/** One account row with an explicit self/Gateway target and a remove action. */
function AccountRow({
	account,
	canSetGateway,
	gatewaySupported,
	onRemove,
	onSwitch,
}: {
	account: ProviderAccount;
	canSetGateway: boolean;
	gatewaySupported: boolean;
	onRemove: (accountId: string) => void;
	onSwitch: (account: ProviderAccount, target: ProviderAccountTarget) => void;
}) {
	const commandNavigation = useProviderCommandNavigation();
	const targetPage = (
		<AccountTargetPage
			account={account}
			canSetGateway={canSetGateway}
			gatewaySupported={gatewaySupported}
			onSwitch={onSwitch}
		/>
	);
	const label = account.provider
		? `${account.label} · ${account.provider}`
		: account.label;

	if (commandNavigation) {
		return (
			<div className="flex items-center gap-1">
				<CommandItem
					className="min-w-0 flex-1"
					data-checked={
						account.active ||
						(account.kind === "api_key" && account.gatewayActive === true)
					}
					onSelect={() =>
						commandNavigation.push({
							body: targetPage,
							title: `Set ${account.label}`,
						})
					}
				>
					<span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
					<AccountStatus account={account} />
				</CommandItem>
				<AccountRemoveButton account={account} onRemove={onRemove} />
			</div>
		);
	}

	return (
		<div className="flex items-center gap-1">
			<DropdownMenuSub>
				<DropdownMenuSubTrigger
					className={cn(
						"min-w-0 flex-1",
						(account.active ||
							(account.kind === "api_key" && account.gatewayActive === true)) &&
							"bg-foreground/10"
					)}
				>
					<span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
					<AccountStatus account={account} />
				</DropdownMenuSubTrigger>
				<DropdownMenuSubContent className="min-w-[220px] p-1">
					{targetPage}
				</DropdownMenuSubContent>
			</DropdownMenuSub>
			<AccountRemoveButton account={account} onRemove={onRemove} />
		</div>
	);
}

function AccountRemoveButton({
	account,
	onRemove,
}: {
	account: ProviderAccount;
	onRemove: (accountId: string) => void;
}) {
	return (
		<Button
			aria-label={`Remove ${account.label}`}
			className="h-6 w-6 shrink-0 px-0"
			onClick={(event) => {
				event.stopPropagation();
				onRemove(account.accountId);
			}}
			size="sm"
			type="button"
			variant="ghost"
		>
			<HugeiconsIcon
				className="text-muted-foreground/70 hover:text-foreground"
				icon={Delete02Icon}
				size={12}
				strokeWidth={2}
			/>
		</Button>
	);
}

/** The account section shared by provider settings and the composer picker. */
export function ProviderAccountSection({
	accounts,
	canSetGateway = true,
	gatewaySupported = false,
	onRemove,
	onSwitch,
}: {
	accounts: ProviderAccount[];
	canSetGateway?: boolean;
	gatewaySupported?: boolean;
	onRemove: (accountId: string) => void;
	onSwitch: (account: ProviderAccount, target: ProviderAccountTarget) => void;
}) {
	if (accounts.length === 0) {
		return null;
	}
	return (
		<div className="border-border/50 border-t pt-1">
			<div className="flex items-center gap-1 px-3 pt-1 pb-0.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
				<span>Accounts</span>
				{gatewaySupported && !canSetGateway && (
					<HugeiconsIcon
						aria-label="Gateway account changes require admin access"
						className="text-muted-foreground/70"
						icon={SquareLock01Icon}
						size={12}
					/>
				)}
			</div>
			{accounts.map((account) => (
				<AccountRow
					account={account}
					canSetGateway={canSetGateway}
					gatewaySupported={gatewaySupported && account.kind === "api_key"}
					key={account.accountId}
					onRemove={onRemove}
					onSwitch={onSwitch}
				/>
			))}
		</div>
	);
}
