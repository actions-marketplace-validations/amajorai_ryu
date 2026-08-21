import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@ryu/ui/components/avatar.tsx";
import { Button } from "@ryu/ui/components/button.tsx";
import {
	DitherAvatar,
	ditherAvatarSeed,
} from "@ryu/ui/components/dither-kit/avatar.tsx";
import { PageHeader } from "@ryu/ui/components/page-header.tsx";
import { toast } from "@ryu/ui/components/sileo.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import { Switch } from "@ryu/ui/components/switch.tsx";
import { ArrowLeft, ArrowRight, Cloud, Computer, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	BACKEND_URL,
	getActiveUserId,
	listAccounts,
	type StoredAccount,
	switchAccount,
} from "@/lib/auth-client.ts";
import { openExternal } from "@/lib/tauri-bridge.ts";
import { addAccountViaDeviceAuth } from "../../../lib/oauth.ts";
import {
	readStartupSelectionPreferences,
	setStartupDefaultAccountId,
	setStartupDefaultNodeName,
	startupSelectionSteps,
} from "../../lib/startup-selection.ts";
import {
	isLocalNode,
	LOCAL_FALLBACK,
	useNodeStore,
} from "../../store/useNodeStore.ts";

type StartupStep = "account" | "node";

function accountLabel(account: StoredAccount): string {
	if (account.isAnonymous) {
		return "Guest";
	}
	return account.name || account.email || "Account";
}

function StartupCard({
	children,
	selected,
	onClick,
}: {
	children: React.ReactNode;
	selected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			aria-pressed={selected}
			className="group relative flex w-full flex-col items-center gap-3 rounded-2xl border border-border/70 bg-background/60 p-5 text-center outline-none transition-colors hover:border-primary/50 hover:bg-muted/60 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/30 data-[selected=true]:border-primary/70 data-[selected=true]:bg-primary/[0.06]"
			data-selected={selected}
			onClick={onClick}
			type="button"
		>
			{children}
		</button>
	);
}

function DefaultSwitch({
	id,
	checked,
	onCheckedChange,
}: {
	id: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}) {
	return (
		<div className="mt-5 flex items-center justify-center gap-2">
			<label className="font-medium text-muted-foreground text-sm" htmlFor={id}>
				Use as default
			</label>
			<Switch checked={checked} id={id} onCheckedChange={onCheckedChange} />
		</div>
	);
}

export function DesktopStartupChooser() {
	const { nodes, defaultNode, setDefault } = useNodeStore();
	const preferences = readStartupSelectionPreferences();
	const initialAccounts = listAccounts();
	const steps = startupSelectionSteps({
		accounts: initialAccounts,
		defaultAccountId: preferences.defaultAccountId,
		defaultNodeName: preferences.defaultNodeName,
		mode: preferences.mode,
		nodes,
	});
	const accountStepEnabled = steps.account;
	const nodeStepEnabled = steps.node;
	const [step, setStep] = useState<StartupStep>(
		accountStepEnabled ? "account" : "node"
	);
	const [accounts, setAccounts] = useState<StoredAccount[]>(initialAccounts);
	const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
		() => getActiveUserId() ?? initialAccounts[0]?.userId ?? null
	);
	const [selectedNodeName, setSelectedNodeName] = useState(() =>
		preferences.defaultNodeName &&
		nodes.some((node) => node.name === preferences.defaultNodeName)
			? preferences.defaultNodeName
			: defaultNode
	);
	const [rememberAccount, setRememberAccount] = useState(
		() => preferences.mode === "defaults" || !preferences.defaultAccountId
	);
	const [rememberNode, setRememberNode] = useState(
		() => preferences.mode === "defaults" || !preferences.defaultNodeName
	);
	const [busy, setBusy] = useState(false);
	const [adding, setAdding] = useState(false);
	const cancelAddAccount = useRef<(() => void) | null>(null);

	const selectedNode =
		nodes.find((node) => node.name === selectedNodeName) ??
		nodes[0] ??
		LOCAL_FALLBACK;
	const hasAccountStep = accountStepEnabled;

	useEffect(() => {
		return () => cancelAddAccount.current?.();
	}, []);

	const refreshAccounts = () => {
		const nextAccounts = listAccounts();
		setAccounts(nextAccounts);
		setSelectedAccountId(getActiveUserId() ?? nextAccounts[0]?.userId ?? null);
	};

	const handleAddAccount = () => {
		if (adding) {
			return;
		}
		setAdding(true);
		cancelAddAccount.current = addAccountViaDeviceAuth(BACKEND_URL, {
			onCode: (info) => {
				openExternal(info.verificationUriComplete).catch(() => undefined);
				toast.show({
					title: "Finish signing in",
					description: `Approve in your browser${
						info.userCode ? ` (code ${info.userCode})` : ""
					} to add the account.`,
				});
			},
			onAdded: (userId) => {
				setAdding(false);
				cancelAddAccount.current = null;
				refreshAccounts();
				setSelectedAccountId(userId);
				toast.success("Account added");
			},
			onError: (error) => {
				setAdding(false);
				cancelAddAccount.current = null;
				toast.error({
					title: "Couldn't add account",
					description: error.message,
				});
			},
		});
	};

	const handleContinue = () => {
		if (step === "account" && nodeStepEnabled) {
			setStep("node");
			return;
		}
		void finish();
	};

	const finish = async () => {
		if (busy) {
			return;
		}
		setBusy(true);
		try {
			if (selectedAccountId && selectedAccountId !== getActiveUserId()) {
				await switchAccount(selectedAccountId);
			}
			if (accountStepEnabled) {
				setStartupDefaultAccountId(rememberAccount ? selectedAccountId : null);
			}
			if (nodeStepEnabled) {
				setStartupDefaultNodeName(rememberNode ? selectedNode.name : null);
			}
			await setDefault(selectedNode.name);
			window.location.reload();
		} catch (error) {
			setBusy(false);
			toast.error({
				title: "Couldn't save startup choices",
				description:
					error instanceof Error ? error.message : "Please try again.",
			});
		}
	};

	return (
		<div
			className="flex h-full w-full items-center justify-center overflow-auto bg-background p-8"
			data-tauri-drag-region="true"
			data-testid="desktop-startup-chooser"
		>
			<div className="w-full max-w-xl">
				{step === "account" ? (
					<div data-testid="startup-account-step">
						<PageHeader
							className="mb-8 text-center"
							stagger={false}
							subtitle="Choose an account"
							title="Welcome back"
						/>

						<div className="grid grid-cols-2 gap-4">
							{accounts.map((account) => {
								const selected = account.userId === selectedAccountId;
								return (
									<StartupCard
										key={account.userId}
										onClick={() => setSelectedAccountId(account.userId)}
										selected={selected}
									>
										<Avatar className="size-16" size="lg">
											<AvatarImage
												alt={accountLabel(account)}
												src={account.image ?? undefined}
											/>
											<AvatarFallback className="overflow-hidden bg-transparent p-0">
												<DitherAvatar
													className="size-full"
													name={ditherAvatarSeed({
														id: account.userId,
														email: account.email,
														name: account.name,
													})}
												/>
											</AvatarFallback>
										</Avatar>
										<span className="flex min-w-0 flex-col items-center">
											<span className="max-w-full truncate font-medium">
												{accountLabel(account)}
											</span>
										</span>
									</StartupCard>
								);
							})}
						</div>

						<DefaultSwitch
							checked={rememberAccount}
							id="startup-default-account"
							onCheckedChange={setRememberAccount}
						/>

						<Button
							className="mt-5 w-full"
							disabled={!selectedAccountId || busy || adding}
							onClick={handleContinue}
							size="lg"
						>
							Continue
							<ArrowRight className="size-4" />
						</Button>

						<Button
							className="mt-2 w-full"
							disabled={busy || adding}
							onClick={handleAddAccount}
							size="sm"
							variant="ghost"
						>
							{adding ? (
								<Spinner className="size-4" />
							) : (
								<Plus className="size-4" />
							)}
							Add account
						</Button>
					</div>
				) : (
					<div data-testid="startup-node-step">
						<PageHeader
							className="mb-8 text-center"
							stagger={false}
							title="Choose a node"
						/>

						<div className="grid grid-cols-2 gap-4">
							{nodes.map((node) => {
								const selected = node.name === selectedNodeName;
								return (
									<StartupCard
										key={node.name}
										onClick={() => setSelectedNodeName(node.name)}
										selected={selected}
									>
										<div className="flex size-16 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-muted/50 text-muted-foreground">
											{isLocalNode(node) ? (
												<Computer className="size-5" />
											) : (
												<Cloud className="size-5" />
											)}
										</div>
										<span className="flex min-w-0 flex-col items-center">
											<span className="truncate font-medium">{node.name}</span>
										</span>
									</StartupCard>
								);
							})}
						</div>

						<DefaultSwitch
							checked={rememberNode}
							id="startup-default-node"
							onCheckedChange={setRememberNode}
						/>

						<div className="mt-5 flex gap-2">
							{hasAccountStep ? (
								<Button
									className="flex-1"
									disabled={busy}
									onClick={() => setStep("account")}
									variant="outline"
								>
									<ArrowLeft className="size-4" />
									Back
								</Button>
							) : null}
							<Button
								className="flex-1"
								disabled={busy || !selectedNode.name}
								onClick={handleContinue}
								size="lg"
							>
								{busy ? <Spinner className="size-4" /> : null}
								Open Ryu
								<ArrowRight className="size-4" />
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
