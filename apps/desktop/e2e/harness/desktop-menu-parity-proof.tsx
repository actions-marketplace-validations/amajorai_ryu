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
import { ThemeProvider, useTheme } from "next-themes";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
	AccountList,
	DesktopThemeSubmenu,
	DesktopWebAccountLinks,
} from "../../src/components/layout/NavUser.tsx";
import { GlobalContextMenu } from "../../src/components/shell/GlobalContextMenu.tsx";
import "../../src/index.css";
import { Check, LogOut, Plus } from "lucide-react";

const webDestinations = [
	{ label: "Profile", path: "/u/demo-user" },
	{ label: "Account", path: "/settings" },
	{ label: "API keys", path: "/api-keys" },
] as const;

const demoStoredAccounts = [
	{
		email: "alex@example.com",
		image: null,
		name: "Alex Chen",
		token: "demo-token-alex",
		userId: "demo-alex",
	},
	{
		email: "sam@example.com",
		image: null,
		name: "Sam Rivera",
		token: "demo-token-sam",
		userId: "demo-sam",
	},
] as const;

if (typeof window !== "undefined") {
	window.localStorage.setItem(
		"ryu_accounts",
		JSON.stringify(demoStoredAccounts)
	);
	window.localStorage.setItem("ryu_active_user_id", "demo-alex");
}

function WebsiteAccountSwitcherProof({
	onSignOutAll,
}: {
	onSignOutAll: () => void;
}) {
	const [activeId, setActiveId] = useState("demo-alex");
	const activeAccount = demoStoredAccounts.find(
		(account) => account.userId === activeId
	);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 font-medium text-sm hover:bg-white/15">
				Website user nav
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-56">
				<DropdownMenuSub>
					<DropdownMenuSubTrigger className="gap-2">
						<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-cyan-400/20 font-semibold text-cyan-100 text-xs">
							{activeAccount?.name.slice(0, 1)}
						</span>
						<span className="flex min-w-0 flex-1 flex-col text-left">
							<span className="truncate text-sm">{activeAccount?.name}</span>
							<span className="truncate text-muted-foreground text-xs">
								{activeAccount?.email}
							</span>
						</span>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="min-w-64">
						<DropdownMenuGroup>
							{demoStoredAccounts.map((account) => (
								<DropdownMenuItem
									closeOnClick={false}
									key={account.userId}
									onClick={() => setActiveId(account.userId)}
								>
									<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-cyan-400/20 font-semibold text-cyan-100 text-xs">
										{account.name.slice(0, 1)}
									</span>
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate text-sm">{account.name}</span>
										<span className="truncate text-muted-foreground text-xs">
											{account.email}
										</span>
									</span>
									{account.userId === activeId ? (
										<Check className="size-4 shrink-0 text-primary" />
									) : null}
								</DropdownMenuItem>
							))}
							<DropdownMenuItem>
								<Plus className="size-4" />
								Add account
							</DropdownMenuItem>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={onSignOutAll} variant="destructive">
							<LogOut className="size-4" />
							Log out of all accounts
						</DropdownMenuItem>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ThemeState() {
	const { theme } = useTheme();
	return <output data-testid="theme-mode">{theme ?? "unset"}</output>;
}

function DesktopMenuParityProof() {
	const [openedPath, setOpenedPath] = useState("None yet");
	const [openedPaths, setOpenedPaths] = useState<string[]>([]);
	const [accountAction, setAccountAction] = useState("None yet");

	const handleOpenWeb = (path: string) => {
		setOpenedPath(path);
		setOpenedPaths((current) => [...current, path]);
	};

	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="light"
			enableSystem
			storageKey="ryu-desktop-menu-parity-proof-theme"
		>
			<ThemeState />
			<GlobalContextMenu>
				<main className="min-h-screen bg-[#0b0f14] p-6 text-slate-100 sm:p-10">
					<div className="mx-auto flex max-w-5xl flex-col gap-6">
						<header className="flex flex-col gap-4 border-white/10 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
							<div>
								<p className="font-medium text-slate-400 text-xs uppercase tracking-[0.18em]">
									React verification artifact
								</p>
								<h1 className="mt-2 font-semibold text-3xl tracking-tight">
									Desktop menu parity
								</h1>
								<p className="mt-2 max-w-2xl text-slate-400 text-sm leading-6">
									This proof mounts the production desktop user-nav links, theme
									submenu, and global right-click menu. Use the controls below
									to verify the web destinations and the shared Sun / Moon /
									Laptop icon treatment.
								</p>
							</div>
							<div
								className="inline-flex w-fit items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 font-semibold text-emerald-200 text-xs"
								data-testid="proof-status"
							>
								Production components mounted
							</div>
						</header>

						<section
							aria-label="Desktop user navigation proof"
							className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
						>
							<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
								<div>
									<h2 className="font-semibold text-lg">
										User nav → web account
									</h2>
									<p className="mt-1 text-slate-400 text-sm">
										Open the menu and choose Profile, Account, or API keys.
									</p>
								</div>
								<DropdownMenu>
									<DropdownMenuTrigger className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 font-medium text-sm hover:bg-white/15">
										Desktop user nav
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="min-w-56">
										<DropdownMenuGroup>
											<DesktopWebAccountLinks
												onOpenWeb={handleOpenWeb}
												profilePath="/u/demo-user"
											/>
										</DropdownMenuGroup>
										<DropdownMenuSeparator />
										<DesktopThemeSubmenu />
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
							<div className="mt-5 grid gap-3 sm:grid-cols-3">
								{webDestinations.map((destination) => (
									<div
										className="rounded-xl border border-white/10 bg-black/20 p-3"
										key={destination.label}
									>
										<div className="font-medium text-sm">
											{destination.label}
										</div>
										<code className="mt-1 block text-slate-400 text-xs">
											{destination.path}
										</code>
									</div>
								))}
							</div>
						</section>

						<section
							aria-label="Account switcher submenu proof"
							className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
						>
							<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
								<div>
									<h2 className="font-semibold text-lg">
										Account switcher submenu
									</h2>
									<p className="mt-1 max-w-2xl text-slate-400 text-sm leading-6">
										Both user-nav triggers keep the active account as the
										submenu trigger. The submenu contains account switching, Add
										account, a separator, and Log out of all accounts.
									</p>
								</div>
								<div className="flex flex-wrap gap-2">
									<DropdownMenu>
										<DropdownMenuTrigger className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 font-medium text-sm hover:bg-white/15">
											Desktop active user
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end" className="min-w-56">
											<AccountList
												activeUser={{
													id: "demo-alex",
													name: "Alex Chen",
													email: "alex@example.com",
													image: null,
												}}
												onSignOutAll={() =>
													setAccountAction("Desktop: Log out of all accounts")
												}
											/>
										</DropdownMenuContent>
									</DropdownMenu>
									<WebsiteAccountSwitcherProof
										onSignOutAll={() =>
											setAccountAction("Website: Log out of all accounts")
										}
									/>
								</div>
							</div>
							<div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-3">
								<div className="text-slate-400 text-xs uppercase tracking-wide">
									Last account action
								</div>
								<div
									className="mt-1 font-mono text-sm"
									data-testid="account-action"
								>
									{accountAction}
								</div>
							</div>
						</section>

						<section
							aria-label="Global context menu proof"
							className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
						>
							<h2 className="font-semibold text-lg">Global right-click menu</h2>
							<p className="mt-1 text-slate-400 text-sm">
								Right-click the panel to open the production menu, then open
								Appearance.
							</p>
							<div
								className="mt-4 rounded-xl border border-violet-300/40 border-dashed bg-violet-300/10 p-6 text-center text-slate-200 text-sm"
								data-testid="context-target"
							>
								Right-click this panel to inspect Appearance and its Light,
								Dark, and System choices.
							</div>
						</section>

						<section
							aria-label="Interaction results"
							className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
						>
							<h2 className="font-semibold text-lg">Interaction results</h2>
							<dl className="mt-4 grid gap-4 sm:grid-cols-2">
								<div>
									<dt className="text-slate-400 text-xs uppercase tracking-wide">
										Last web destination
									</dt>
									<dd
										className="mt-1 font-mono text-sm"
										data-testid="opened-path"
									>
										{openedPath}
									</dd>
								</div>
								<div>
									<dt className="text-slate-400 text-xs uppercase tracking-wide">
										Paths opened in this run
									</dt>
									<dd
										className="mt-1 font-mono text-sm"
										data-testid="opened-paths"
									>
										{openedPaths.length > 0
											? openedPaths.join(" → ")
											: "None yet"}
									</dd>
								</div>
							</dl>
						</section>
					</div>
				</main>
			</GlobalContextMenu>
		</ThemeProvider>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<DesktopMenuParityProof />);
}
