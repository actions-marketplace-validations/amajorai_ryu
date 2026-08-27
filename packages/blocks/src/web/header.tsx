"use client";

import { Badge } from "@ryu/ui/components/badge";
import { buttonVariants } from "@ryu/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@ryu/ui/components/dropdown-menu.tsx";
import { Logo } from "@ryu/ui/components/logo";
import {
	MotionNavigationMenu,
	MotionNavigationMenuContent,
	MotionNavigationMenuItem,
	MotionNavigationMenuLink,
	MotionNavigationMenuList,
	MotionNavigationMenuTrigger,
} from "@ryu/ui/components/motion-navigation-menu";
import { cn } from "@ryu/ui/lib/utils";
import { ChevronDown } from "lucide-react";
// import { Link2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PRODUCT_REALMS } from "./data/product-realms.ts";
import {
	DOCS_URL,
	resourceCategories,
	resourcesByCategory,
} from "./data/resources.tsx";
// import { solutionCategories, solutionsByCategory } from "./data/solutions.ts";
import { ProgressiveBlur } from "./progressive-blur.tsx";

interface HeaderLink {
	external?: boolean;
	label: string;
	to: string;
}

// Header stays minimal: the Products menu shows Ryu's mental model — workspaces
// and standalone services on top, with the open platform and infrastructure
// underneath. Solutions and Resources remain separate; Marketplace is the one
// flat link for discovering everything an agent can run.
const MARKETING_LINKS: readonly HeaderLink[] = [
	{ to: "/marketplace", label: "Marketplace" },
];

const SURFACE_LINKS = [
	...PRODUCT_REALMS.filter((realm) =>
		["os", "bot", "console", "box", "hire"].includes(realm.id)
	).map(({ href, label }) => ({ href, label })),
	{ href: "/marketplace/apps", label: "Ryu Apps" },
];

const PLATFORM_LINKS = [
	...PRODUCT_REALMS.filter((realm) => realm.id === "gateway").map(
		({ href, label }) => ({ href, label })
	),
	{
		href: "/products/sdk",
		label: "SDKs",
	},
	{
		href: "/products/core",
		label: "Core",
	},
] as const;

const INFRA_LINKS = [
	{
		href: "/platform#infra",
		label: "Ryu Cloud",
	},
	{
		href: "/platform#infra",
		label: "Self-hosted",
	},
] as const;

function ProductLinkGroup({
	links,
	title,
}: {
	links: readonly { href: string; label: string }[];
	title: string;
}) {
	return (
		<div>
			<p className="mb-2 px-3 font-medium text-muted-foreground text-sm">
				{title}
			</p>
			<div>
				{links.map((product) => (
					<MotionNavigationMenuLink
						className="px-3 py-1"
						key={product.label}
						render={<Link href={product.href as Route} />}
					>
						<span className="font-semibold text-foreground text-xl tracking-tight transition-colors hover:text-accent-foreground">
							{product.label}
						</span>
					</MotionNavigationMenuLink>
				))}
			</div>
		</div>
	);
}

function PrimaryProductLinks() {
	return (
		<div>
			<div className="grid w-[760px] grid-cols-3 gap-x-6 gap-y-7 p-2">
				<ProductLinkGroup links={SURFACE_LINKS} title="Products" />
				<ProductLinkGroup links={PLATFORM_LINKS} title="Platform" />
				<ProductLinkGroup links={INFRA_LINKS} title="Infrastructure" />
			</div>
			<div className="mt-1 border-border/60 border-t px-3 pt-2.5">
				<MotionNavigationMenuLink
					className="px-3"
					render={<Link href="/platform" />}
				>
					<span className="font-medium text-foreground text-sm">
						Explore Ryu Platform →
					</span>
				</MotionNavigationMenuLink>
			</div>
		</div>
	);
}

function ProductsMenu({ pathname }: { pathname: string }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				className={cn(
					buttonVariants({ variant: "ghost" }),
					"gap-1 hover:bg-muted hover:text-foreground",
					(pathname.startsWith("/products") ||
						pathname === "/bot" ||
						pathname === "/console" ||
						pathname === "/build" ||
						pathname === "/platform" ||
						pathname.startsWith("/marketplace/apps")) &&
						"bg-muted"
				)}
			>
				Products
				<ChevronDown aria-hidden="true" className="size-3.5" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="center"
				className="!w-[800px] rounded-2xl p-2"
				withBackdrop={false}
			>
				<PrimaryProductLinks />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export default function Header({
	className,
	userMenu,
	orgSlot,
	links = MARKETING_LINKS,
	showCatalogMenus = true,
	homeHref = "/",
	signedIn = false,
}: {
	className?: string;
	signedIn?: boolean;
	userMenu?: ReactNode;
	/**
	 * Vercel-style breadcrumb slot rendered immediately after the logo/badge,
	 * separated by a muted "/". Portal surfaces pass the org switcher here so it
	 * reads as `logo / [org ▾]`. Presentational only — the block owns the
	 * separator, the caller owns the control.
	 */
	orgSlot?: ReactNode;
	/** Nav links to render. Defaults to the marketing links. */
	links?: readonly HeaderLink[];
	/**
	 * Whether to render the marketing Products/Solutions mega-menus. Portal
	 * surfaces pass `false` so the header shows only the provided `links`. The
	 * signed-in Dashboard shortcut now lives in the user menu dropdown.
	 */
	showCatalogMenus?: boolean;
	/** Where the logo links to. Marketing → "/", portal → "/dashboard". */
	homeHref?: string;
}) {
	const pathname = usePathname();

	return (
		<div className={`relative ${className ?? ""}`}>
			{/* Progressive blur background */}
			<ProgressiveBlur
				blurAmount="12px"
				className="absolute inset-0 z-0"
				height="100px"
				position="top"
				useThemeBackground
			/>

			<div className="relative z-10 flex flex-row items-center justify-between p-4 px-10">
				<div className="flex flex-1 items-center gap-3">
					<Link className="flex items-center gap-4" href={homeHref as Route}>
						<Logo size="28px" variant="outline" />
						<Badge className="rounded-bl-lg" variant="secondary">
							Research Preview
						</Badge>
					</Link>
					{orgSlot ? (
						<div className="flex items-center gap-3">
							<span
								aria-hidden="true"
								className="select-none text-lg text-muted-foreground/40"
							>
								/
							</span>
							{orgSlot}
						</div>
					) : null}
				</div>

				<nav className="hidden items-center font-medium md:flex">
					{showCatalogMenus && (
						<MotionNavigationMenu viewportClassName="shadow-none">
							<MotionNavigationMenuList>
								<MotionNavigationMenuItem value="products">
									<ProductsMenu pathname={pathname} />
								</MotionNavigationMenuItem>

								{/* Solutions menu paused until the product hierarchy is settled. */}
								{/*
								<MotionNavigationMenuItem value="solutions">
									<MotionNavigationMenuTrigger
										className={cn(
											pathname.startsWith("/for") && "text-accent-foreground"
										)}
									>
										Solutions
									</MotionNavigationMenuTrigger>
									<MotionNavigationMenuContent>
										<div className="grid w-[820px] grid-cols-3 gap-x-6 gap-y-7 p-2">
											{solutionCategories.map((category) => (
												<div key={category}>
													<p className="mb-2 px-3 font-medium text-muted-foreground text-sm">
														{category}
													</p>
													<div>
														{solutionsByCategory(category).map((solution) => (
															<MotionNavigationMenuLink
																className="px-3 py-1"
																key={solution.slug}
																render={
																	<Link
																		href={`/for/${solution.slug}` as Route}
																	/>
																}
															>
																<span className="font-semibold text-foreground text-xl tracking-tight transition-colors hover:text-accent-foreground">
																	{solution.navLabel}
																</span>
															</MotionNavigationMenuLink>
														))}
													</div>
												</div>
											))}
										</div>
										<div className="mt-1 space-y-1 border-border/60 border-t px-3 pt-2.5">
											<MotionNavigationMenuLink
												className="flex-row items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2.5"
												render={<Link href={"/for/agent-operators" as Route} />}
											>
												<Link2
													className="size-4 shrink-0 text-foreground/70"
													strokeWidth={1.5}
												/>
												<div className="min-w-0">
													<p className="font-medium text-foreground text-sm">
														Run AI for clients
													</p>
													<p className="truncate text-muted-foreground text-xs">
														Help teams make AI safe and repeatable
													</p>
												</div>
											</MotionNavigationMenuLink>
											<MotionNavigationMenuLink
												className="px-3"
												render={<Link href="/for" />}
											>
												<span className="font-medium text-foreground text-sm">
													View all roles →
												</span>
											</MotionNavigationMenuLink>
										</div>
									</MotionNavigationMenuContent>
								</MotionNavigationMenuItem>
								*/}

								<MotionNavigationMenuItem value="resources">
									<MotionNavigationMenuTrigger
										className={cn(
											(pathname.startsWith("/docs") ||
												pathname.startsWith("/academy") ||
												pathname.startsWith("/certifications") ||
												pathname.startsWith("/marketplace") ||
												pathname.startsWith("/compare") ||
												pathname.startsWith("/pricing") ||
												pathname.startsWith("/subscriptions") ||
												pathname.startsWith("/community") ||
												pathname.startsWith("/blog") ||
												pathname.startsWith("/changelog") ||
												pathname.startsWith("/help")) &&
												"text-accent-foreground"
										)}
									>
										Resources
									</MotionNavigationMenuTrigger>
									<MotionNavigationMenuContent>
										<div className="grid w-[820px] grid-cols-3 gap-x-6 gap-y-7 p-2">
											{resourceCategories.map((category) => (
												<div key={category}>
													<p className="mb-2 px-3 font-medium text-muted-foreground text-sm">
														{category}
													</p>
													<div>
														{resourcesByCategory(category).map((resource) => (
															<MotionNavigationMenuLink
																className="px-3 py-1"
																key={resource.href}
																render={
																	<Link
																		href={resource.href as Route}
																		rel={
																			resource.external
																				? "noopener noreferrer"
																				: undefined
																		}
																		target={
																			resource.external ? "_blank" : undefined
																		}
																	/>
																}
															>
																<span className="font-semibold text-foreground text-xl tracking-tight transition-colors hover:text-accent-foreground">
																	{resource.label}
																</span>
															</MotionNavigationMenuLink>
														))}
													</div>
												</div>
											))}
										</div>
										<div className="mt-1 border-border/60 border-t px-3 pt-2.5">
											<MotionNavigationMenuLink
												className="px-3"
												render={
													<Link
														href={DOCS_URL as Route}
														rel="noopener noreferrer"
														target="_blank"
													/>
												}
											>
												<span className="font-medium text-foreground text-sm">
													Read the docs →
												</span>
											</MotionNavigationMenuLink>
										</div>
									</MotionNavigationMenuContent>
								</MotionNavigationMenuItem>
							</MotionNavigationMenuList>
						</MotionNavigationMenu>
					)}

					{links.map(({ to, label, external }) => {
						const isActive = !external && pathname.startsWith(to);
						return (
							<a
								className={cn(
									buttonVariants({ variant: "ghost" }),
									"hover:bg-muted hover:text-foreground",
									isActive && "bg-muted"
								)}
								href={to}
								key={to}
								rel={external ? "noopener noreferrer" : undefined}
								target={external ? "_blank" : "_self"}
							>
								{label}
							</a>
						);
					})}
				</nav>

				<div className="hidden flex-1 items-center justify-end md:flex">
					{userMenu}
				</div>
			</div>
		</div>
	);
}
