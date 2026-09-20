"use client";

import { useLocalizedString, useLocalizedText } from "@ryu/i18n/react";
import { Badge } from "@ryu/ui/components/badge";
import { buttonVariants } from "@ryu/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
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
import { ArrowLeft, Menu } from "lucide-react";
// import { Link2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
	PRODUCT_NAV_GROUPS,
	PRODUCT_REALMS,
	productRealmsFor,
} from "./data/product-realms.ts";
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

function LocalizedHeaderCopy({ value }: { value: string }) {
	return <>{useLocalizedText(value, { literal: true })}</>;
}

// Header stays minimal: the Products menu shows Ryu's mental model — primary
// products, service APIs, and capacity/apps sit together, with the platform and
// infrastructure underneath. Solutions and Resources remain separate;
// Marketplace is the one flat link for discovering everything an agent can run.
const MARKETING_LINKS: readonly HeaderLink[] = [
	{ to: "/marketplace", label: "Marketplace" },
];

const PRODUCT_LINKS = PRODUCT_NAV_GROUPS.map((group) => ({
	...group,
	links: productRealmsFor(group.ids).map(({ href, shortLabel }) => ({
		href,
		label: shortLabel,
	})),
}));

const [MAIN_PRODUCT_LINKS, SERVICE_API_LINKS, CAPACITY_AND_APP_LINKS] =
	PRODUCT_LINKS;

const CAPACITY_AND_APP_LINKS_WITH_APPS = [
	...CAPACITY_AND_APP_LINKS.links,
	{ href: "/products/apps", label: "Apps" },
];

const PLATFORM_LINKS = [
	...PRODUCT_REALMS.filter((realm) => realm.id === "gateway").map(
		({ href, shortLabel }) => ({ href, label: shortLabel })
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
		label: "Cloud",
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
	const localizedTitle = useLocalizedText(title, { literal: true });
	return (
		<div data-product-group={title}>
			<p className="mb-2 px-3 font-medium text-muted-foreground text-sm">
				{localizedTitle}
			</p>
			<div>
				{links.map((product) => (
					<MotionNavigationMenuLink
						className="px-3 py-1"
						key={product.label}
						render={
							<Link data-cuelume-hover="tick" href={product.href as Route} />
						}
					>
						<span className="font-medium text-foreground text-xl tracking-tight transition-colors hover:text-accent-foreground">
							<LocalizedHeaderCopy value={product.label} />
						</span>
					</MotionNavigationMenuLink>
				))}
			</div>
		</div>
	);
}

function PrimaryProductLinks() {
	const exploreLabel = useLocalizedText("Explore the platform →", {
		literal: true,
	});
	return (
		<div>
			<div className="grid w-[760px] grid-cols-3 gap-x-6 gap-y-7 p-2">
				<ProductLinkGroup
					links={MAIN_PRODUCT_LINKS.links}
					title={MAIN_PRODUCT_LINKS.title}
				/>
				<ProductLinkGroup
					links={SERVICE_API_LINKS.links}
					title={SERVICE_API_LINKS.title}
				/>
				<ProductLinkGroup
					links={CAPACITY_AND_APP_LINKS_WITH_APPS}
					title={CAPACITY_AND_APP_LINKS.title}
				/>
				<div className="col-span-3 grid grid-cols-3 gap-x-6">
					<ProductLinkGroup links={PLATFORM_LINKS} title="Platform" />
					<ProductLinkGroup links={INFRA_LINKS} title="Infrastructure" />
					<div className="pt-7" data-testid="product-menu-explore">
						<MotionNavigationMenuLink
							className="px-3 py-1"
							render={<Link data-cuelume-hover="tick" href="/platform" />}
						>
							<span className="font-medium text-foreground text-xl tracking-tight">
								{exploreLabel}
							</span>
						</MotionNavigationMenuLink>
					</div>
				</div>
			</div>
		</div>
	);
}

function ProductsMenu({ pathname }: { pathname: string }) {
	const productsLabel = useLocalizedText("Products", { literal: true });
	return (
		<>
			<MotionNavigationMenuTrigger
				className={cn(
					(pathname.startsWith("/products") ||
						pathname === "/bot" ||
						pathname === "/console" ||
						pathname === "/build" ||
						pathname === "/platform" ||
						pathname.startsWith("/products/apps")) &&
						"bg-muted"
				)}
			>
				{productsLabel}
			</MotionNavigationMenuTrigger>
			<MotionNavigationMenuContent>
				<PrimaryProductLinks />
			</MotionNavigationMenuContent>
		</>
	);
}

function isHeaderLinkActive(pathname: string, link: HeaderLink) {
	return (
		!link.external &&
		(pathname === link.to || pathname.startsWith(`${link.to}/`))
	);
}

function HeaderLinkList({
	links,
	pathname,
	portal = false,
}: {
	links: readonly HeaderLink[];
	pathname: string;
	portal?: boolean;
}) {
	return (
		<>
			{links.map((link) => {
				const active = isHeaderLinkActive(pathname, link);
				const className = portal
					? cn(
							"relative inline-flex h-12 shrink-0 items-center rounded-none px-3 font-medium text-sm transition-colors after:pointer-events-none after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full",
							active
								? "text-foreground after:bg-foreground"
								: "text-muted-foreground hover:text-foreground"
						)
					: cn(
							buttonVariants({ size: "sm", variant: "ghost" }),
							"text-foreground hover:bg-muted hover:text-foreground",
							active && "bg-muted text-foreground"
						);
				if (link.external) {
					return (
						<a
							className={className}
							data-cuelume-hover="tick"
							href={link.to}
							key={link.to}
							rel="noopener noreferrer"
							target="_blank"
						>
							<LocalizedHeaderCopy value={link.label} />
						</a>
					);
				}
				return (
					<Link
						aria-current={active ? "page" : undefined}
						className={className}
						data-cuelume-hover="tick"
						href={link.to as Route}
						key={link.to}
					>
						<LocalizedHeaderCopy value={link.label} />
					</Link>
				);
			})}
		</>
	);
}

function PortalMobileNavigation({
	links,
	pathname,
}: {
	links: readonly HeaderLink[];
	pathname: string;
}) {
	const localizedNavigationLabel = useLocalizedString(
		"Open workspace navigation"
	);
	if (links.length === 0) {
		return null;
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={localizedNavigationLabel}
				className={cn(
					buttonVariants({ size: "icon-sm", variant: "ghost" }),
					"md:hidden"
				)}
			>
				<Menu aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="min-w-52 p-1"
				withBackdrop={false}
			>
				<DropdownMenuGroup>
					<DropdownMenuLabel>Workspace</DropdownMenuLabel>
					{links.map((link) => {
						const active = isHeaderLinkActive(pathname, link);
						return (
							<DropdownMenuItem
								className={cn(active && "bg-foreground/10")}
								key={link.to}
								render={
									link.external ? (
										<a
											href={link.to}
											rel="noopener noreferrer"
											target="_blank"
										/>
									) : (
										<Link href={link.to as Route} />
									)
								}
							>
								{link.label}
							</DropdownMenuItem>
						);
					})}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export default function Header({
	className,
	userMenu,
	orgSlot,
	portalUtilityMenu,
	portalContextNav,
	inverse = false,
	links = MARKETING_LINKS,
	showCatalogMenus = true,
	homeHref = "/",
	signedIn = false,
	transparent = false,
	variant = "marketing",
}: {
	className?: string;
	signedIn?: boolean;
	/** Render the portal chrome with foreground/background roles inverted. */
	inverse?: boolean;
	variant?: "marketing" | "portal";
	userMenu?: ReactNode;
	/**
	 * Workspace context rendered after the account controls in the portal header.
	 * Portal surfaces pass the organization switcher here so the current workspace
	 * stays visible while people move between the primary routes.
	 */
	orgSlot?: ReactNode;
	/** Utility actions kept on the right side of the portal header. */
	portalUtilityMenu?: ReactNode;
	/** Contextual tabs rendered in the portal header instead of the global nav. */
	portalContextNav?: ReactNode;
	/** Nav links to render. Defaults to the marketing links. */
	links?: readonly HeaderLink[];
	/**
	 * Whether to render the marketing Products/Solutions mega-menus. Portal
	 * surfaces pass `false` so the header shows only the provided `links`. The
	 * signed-in Dashboard shortcut now lives in the user menu dropdown.
	 */
	showCatalogMenus?: boolean;
	/** Where the marketing home link goes. Portal surfaces omit the brand link. */
	homeHref?: string;
	/** Let a landing visual continue behind the marketing header. */
	transparent?: boolean;
}) {
	const pathname = usePathname();
	const localizedBackToDashboard = useLocalizedString("Back to dashboard");
	const localizedDashboard = useLocalizedText("Dashboard", { literal: true });
	const localizedWorkspaceNavigation = useLocalizedString(
		"Workspace navigation"
	);
	const localizedResearchPreview = useLocalizedText("Research Preview", {
		literal: true,
	});
	const localizedResources = useLocalizedText("Resources", { literal: true });

	if (variant === "portal") {
		return (
			<div className={cn("relative", className)}>
				<div
					className={cn(
						"backdrop-blur-xl",
						inverse
							? "bg-foreground text-background"
							: "border-border/70 border-b bg-background/85"
					)}
				>
					<div className="mx-auto w-full max-w-7xl">
						<div className="flex min-h-14 items-center gap-2 px-4 sm:px-6">
							{userMenu ? (
								<div className="flex min-w-0 items-center gap-1.5">
									{userMenu}
								</div>
							) : null}
							{orgSlot ? (
								<div className="flex min-w-0 items-center gap-2">
									<span
										aria-hidden="true"
										className={cn(
											"select-none text-lg",
											inverse
												? "text-background/40"
												: "text-muted-foreground/40"
										)}
									>
										/
									</span>
									<div className="min-w-0">{orgSlot}</div>
								</div>
							) : null}
							{portalUtilityMenu ? (
								<div className="ml-auto flex items-center gap-1.5">
									{portalUtilityMenu}
								</div>
							) : null}
						</div>
						{portalContextNav ? (
							<div className="flex min-h-12 items-center gap-3 px-4 sm:px-6">
								<Link
									aria-label={localizedBackToDashboard}
									className={cn(
										"inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
										inverse
											? "text-background/70 hover:bg-background/10 hover:text-background focus-visible:ring-background"
											: "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring"
									)}
									data-cuelume-hover="tick"
									href="/dashboard"
								>
									<ArrowLeft aria-hidden="true" className="size-4" />
									<span>{localizedDashboard}</span>
								</Link>
								<div className="min-w-0 flex-1 overflow-x-auto">
									{portalContextNav}
								</div>
							</div>
						) : links.length > 0 ? (
							<div className="flex min-h-12 items-center px-4 sm:px-6">
								<nav
									aria-label={localizedWorkspaceNavigation}
									className="hidden items-center gap-0.5 md:flex"
								>
									<HeaderLinkList links={links} pathname={pathname} portal />
								</nav>
								<div className="ml-auto md:hidden">
									<PortalMobileNavigation links={links} pathname={pathname} />
								</div>
							</div>
						) : null}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div
			className={cn(className ? undefined : "relative", className)}
			data-transparent={transparent ? "true" : undefined}
		>
			{transparent ? null : (
				<ProgressiveBlur
					blurAmount="12px"
					className="absolute inset-0 z-0"
					height="100px"
					position="top"
					useThemeBackground
				/>
			)}

			<div
				className={cn(
					"relative z-10 flex flex-row items-center justify-between gap-4 p-4 px-4 sm:px-6 lg:px-10",
					transparent && "bg-background/20 backdrop-blur-sm"
				)}
			>
				<div className="flex min-w-0 flex-1 items-center gap-3">
					<Link
						className="flex min-w-0 items-center gap-4"
						data-cuelume-hover="tick"
						href={homeHref as Route}
					>
						<Logo size="28px" variant="outline" />
						<Badge
							className="hidden shrink-0 rounded-bl-lg lg:inline-flex"
							variant="secondary"
						>
							{localizedResearchPreview}
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

				<nav className="hidden shrink-0 items-center font-medium md:flex">
					{showCatalogMenus && (
						<MotionNavigationMenu viewportClassName="bg-background shadow-none backdrop-blur-none backdrop-saturate-100">
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
																<span className="font-medium text-foreground text-xl tracking-tight transition-colors hover:text-accent-foreground">
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
										{localizedResources}
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
																		data-cuelume-hover="tick"
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
																<span className="font-medium text-foreground text-xl tracking-tight transition-colors hover:text-accent-foreground">
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
														data-cuelume-hover="tick"
														href={DOCS_URL as Route}
														rel="noopener noreferrer"
														target="_blank"
													/>
												}
											>
												<span className="font-medium text-foreground text-sm">
													<LocalizedHeaderCopy value="Read the docs →" />
												</span>
											</MotionNavigationMenuLink>
										</div>
									</MotionNavigationMenuContent>
								</MotionNavigationMenuItem>
							</MotionNavigationMenuList>
						</MotionNavigationMenu>
					)}

					<HeaderLinkList links={links} pathname={pathname} />
				</nav>

				<div className="hidden min-w-0 flex-1 items-center justify-end md:flex">
					{userMenu}
				</div>
			</div>
		</div>
	);
}
