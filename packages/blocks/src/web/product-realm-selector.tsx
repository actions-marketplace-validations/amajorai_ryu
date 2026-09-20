import { cn } from "@ryu/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
	Activity,
	ArrowUpRight,
	AtSign,
	Bot,
	Cloud,
	FileText,
	Fingerprint,
	Folder,
	Globe2,
	KeyRound,
	Mail,
	MessageCircle,
	Network,
	Radar,
	ShieldCheck,
	Sparkles,
	SquareTerminal,
	Store,
	UserRound,
	Users,
	Workflow,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import type { ProductRealmId } from "./data/product-realms.ts";
import { PRODUCT_REALMS } from "./data/product-realms.ts";
import { GatewayRequestPreview } from "./gateway-request-preview.tsx";
import {
	DeploymentPreview,
	ToolAccessPreview,
} from "./product-demo-previews.tsx";

type ProductId = ProductRealmId | "apps";

interface ProductChoice {
	href: string;
	icon: LucideIcon;
	id: ProductId;
	label: string;
}

type ProductDemo = ComponentType<{ compact?: boolean }>;

const FEATURED_DEMOS: {
	className: string;
	Component: ProductDemo;
	id: ProductRealmId;
}[] = [
	{
		className: "sm:col-span-2 xl:col-span-4",
		Component: ToolAccessPreview,
		id: "connect",
	},
	{
		className: "sm:col-span-2 xl:col-span-4",
		Component: GatewayRequestPreview,
		id: "gateway",
	},
	{
		className: "sm:col-span-2 xl:col-span-4",
		Component: DeploymentPreview,
		id: "compute",
	},
];

const APP_PRODUCT: ProductChoice = {
	href: "/products/apps",
	icon: Store,
	id: "apps",
	label: "Ryu Apps",
};

const LARGE_PEEK_IDS = new Set<ProductRealmId>(["os", "console"]);
const FEATURED_IDS = new Set(FEATURED_DEMOS.map(({ id }) => id));
const FEATURED_PRODUCTS = FEATURED_DEMOS.flatMap(({ id, ...demo }) => {
	const product = PRODUCT_REALMS.find((realm) => realm.id === id);
	return product ? [{ ...demo, product }] : [];
});
const LARGE_PRODUCTS: ProductChoice[] = PRODUCT_REALMS.filter((product) =>
	LARGE_PEEK_IDS.has(product.id)
);
const COMPACT_PRODUCTS: ProductChoice[] = [
	...PRODUCT_REALMS.filter(
		(product) =>
			!(FEATURED_IDS.has(product.id) || LARGE_PEEK_IDS.has(product.id))
	),
	APP_PRODUCT,
];

function ProductExploreLink({ product }: { product: ProductChoice }) {
	return (
		<Link
			className="group absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pt-10 pb-4 text-foreground outline-offset-4 backdrop-blur-sm focus-visible:outline-2 focus-visible:outline-ring"
			data-testid={`realm-card-${product.id}`}
			href={product.href as Route}
		>
			<span className="font-medium text-sm">{product.label}</span>
			<span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
				Explore
				<ArrowUpRight
					aria-hidden="true"
					className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
				/>
			</span>
		</Link>
	);
}

function ProductDemoCard({
	className,
	Component,
	product,
}: {
	className: string;
	Component: ProductDemo;
	product: ProductChoice;
}) {
	return (
		<article
			className={cn(
				"group relative isolate flex min-w-0 flex-col overflow-hidden rounded-3xl border border-border bg-background text-foreground transition-colors focus-within:border-foreground/30 hover:border-foreground/20",
				className
			)}
			data-testid={`product-demo-${product.id}`}
		>
			<ShowcaseGlow className="-top-10 -right-8 z-0 size-32 bg-primary/20" />
			<div
				className="relative z-10 min-h-0 flex-1 p-2 pb-12 sm:p-3 sm:pb-12"
				data-product-demo
			>
				<Component compact />
			</div>
			<ProductExploreLink product={product} />
		</article>
	);
}

function ShowcaseGlow({ className }: { className: string }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"pointer-events-none absolute rounded-full blur-3xl",
				"showcase-loop animate-glow-breathe",
				className
			)}
		/>
	);
}

function ShowcaseSurface({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"relative isolate flex h-full min-h-[9rem] flex-col overflow-hidden rounded-[1.75rem] bg-background p-4 text-foreground sm:p-5",
				className
			)}
		>
			{children}
		</div>
	);
}

function ShowcaseMeta({
	eyebrow,
	status,
}: {
	eyebrow: string;
	status: string;
}) {
	return (
		<div className="relative z-10 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
			<span className="font-medium text-foreground">{eyebrow}</span>
			<span>{status}</span>
		</div>
	);
}

function ProductPeekContent({ product }: { product: ProductChoice }) {
	switch (product.id) {
		case "apps":
			return (
				<ShowcaseSurface>
					<ShowcaseGlow className="-top-10 -right-8 size-36 bg-sky-400/25" />
					<ShowcaseMeta eyebrow="Ryu surfaces" status="4 live" />
					<div className="relative z-10 mt-auto grid grid-cols-2 gap-2 pt-8">
						{[
							{ Icon: Folder, label: "Sites" },
							{ Icon: Mail, label: "Inbox" },
							{ Icon: Workflow, label: "Board" },
							{ Icon: FileText, label: "Docs" },
						].map(({ Icon, label }) => (
							<div
								className="flex items-center gap-2 rounded-2xl bg-card/75 p-3 text-xs shadow-sm ring-1 ring-border/50"
								key={label}
							>
								<Icon aria-hidden="true" className="size-4 text-primary" />
								{label}
							</div>
						))}
					</div>
				</ShowcaseSurface>
			);
		case "box":
			return (
				<ShowcaseSurface>
					<ShowcaseGlow className="-bottom-10 -left-8 size-32 bg-amber-400/25" />
					<ShowcaseMeta eyebrow="Workspace" status="box_7f3a" />
					<div className="relative z-10 flex flex-1 items-center justify-center py-3">
						<div className="absolute h-24 w-40 rotate-[-8deg] rounded-3xl bg-primary/10 ring-1 ring-border/40" />
						<div className="absolute h-24 w-40 rotate-6 rounded-3xl bg-muted/70 ring-1 ring-border/40" />
						<div className="relative w-[82%] rounded-2xl bg-card/85 p-4 shadow-xl ring-1 ring-border/60 backdrop-blur-sm">
							<div className="flex items-center gap-2 font-medium text-xs">
								<FileText aria-hidden="true" className="size-4 text-primary" />
								brief.md
							</div>
							<div className="mt-4 space-y-2">
								<div className="showcase-loop h-1.5 w-4/5 animate-chunk-appear rounded-full bg-foreground/15" />
								<div className="showcase-loop h-1.5 w-3/5 animate-chunk-appear rounded-full bg-foreground/10" />
								<div className="showcase-loop h-1.5 w-2/3 animate-chunk-appear rounded-full bg-primary/45" />
							</div>
							<div className="mt-4 flex items-center gap-2 text-[10px] text-muted-foreground">
								<SquareTerminal
									aria-hidden="true"
									className="size-3.5 text-primary"
								/>
								preview server
								<span className="ml-auto text-emerald-500">live</span>
							</div>
						</div>
					</div>
				</ShowcaseSurface>
			);
		case "bot":
			return (
				<ShowcaseSurface>
					<ShowcaseGlow className="-top-12 -right-10 size-40 bg-primary/30" />
					<ShowcaseMeta eyebrow="Agent thread" status="online" />
					<div className="relative z-10 mt-auto space-y-2 pt-8 text-xs">
						<div className="ml-auto flex max-w-[82%] items-center gap-2 rounded-2xl bg-primary px-3 py-2.5 text-primary-foreground shadow-lg shadow-primary/15">
							<MessageCircle aria-hidden="true" className="size-4" />
							Summarize my inbox
						</div>
						<div className="showcase-loop flex max-w-[88%] animate-tool-float items-center gap-2 rounded-2xl bg-card/75 px-3 py-2.5 ring-1 ring-border/50">
							<Bot aria-hidden="true" className="size-4 text-primary" />3
							threads need attention.
						</div>
					</div>
				</ShowcaseSurface>
			);
		case "console":
			return (
				<ShowcaseSurface className="min-h-52">
					<ShowcaseGlow className="-top-12 left-1/3 size-40 bg-primary/25" />
					<ShowcaseMeta eyebrow="Ryu Console" status="live" />
					<div className="relative z-10 flex flex-1 items-center justify-center py-3">
						<div className="absolute size-36 rounded-full border border-primary/20 shadow-[0_0_70px_theme(colors.primary/20)]" />
						<div className="absolute size-24 rounded-full border border-primary/30 border-dashed" />
						<div className="showcase-loop absolute top-1/2 left-1/2 size-3 animate-vec-orbit rounded-full bg-primary shadow-lg shadow-primary/50" />
						<div className="showcase-loop relative flex size-16 animate-node-pulse items-center justify-center rounded-full bg-primary/15 text-primary shadow-lg shadow-primary/20 ring-1 ring-primary/30">
							<Radar aria-hidden="true" className="size-7" />
						</div>
						<div className="absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-card/80 px-2.5 py-1.5 text-[10px] ring-1 ring-border/60 backdrop-blur-sm">
							<Cloud aria-hidden="true" className="size-3 text-primary" />
							Ryu Cloud
						</div>
						<div className="absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-1.5 text-[9px] text-muted-foreground">
							{["Core", "Gateway", "Apps"].map((label, index) => (
								<span
									className="rounded-full bg-card/75 px-2 py-1 ring-1 ring-border/50"
									key={label}
								>
									<span
										className={cn(
											"mr-1 inline-block size-1.5 rounded-full",
											index === 0 ? "bg-primary" : "bg-muted-foreground/40"
										)}
									/>
									{label}
								</span>
							))}
						</div>
					</div>
				</ShowcaseSurface>
			);
		case "hire":
			return (
				<ShowcaseSurface>
					<ShowcaseGlow className="-right-10 -bottom-8 size-36 bg-violet-400/25" />
					<ShowcaseMeta eyebrow="Specialist pool" status="42 credits" />
					<div className="relative z-10 flex flex-1 items-center justify-center py-2">
						<div className="absolute size-24 rounded-full border border-violet-400/25" />
						<div className="showcase-loop relative flex size-16 animate-node-pulse items-center justify-center rounded-full bg-violet-500/15 text-violet-500 ring-1 ring-violet-400/30">
							<Users aria-hidden="true" className="size-7" />
						</div>
						<div className="absolute top-2 left-1/2 flex -translate-x-1/2 -rotate-6 items-center gap-1.5 rounded-full bg-card/80 px-2.5 py-1.5 text-[10px] ring-1 ring-border/60">
							<UserRound aria-hidden="true" className="size-3 text-primary" />
							Policy analyst
						</div>
						<div className="absolute right-0 bottom-2 flex items-center gap-1.5 rounded-full bg-card/80 px-2.5 py-1.5 text-[10px] ring-1 ring-border/60">
							<UserRound aria-hidden="true" className="size-3 text-primary" />
							Release review
						</div>
					</div>
				</ShowcaseSurface>
			);
		case "mail":
			return (
				<ShowcaseSurface>
					<ShowcaseGlow className="-top-10 -right-10 size-36 bg-orange-400/25" />
					<ShowcaseMeta eyebrow="Agent inbox" status="3 unread" />
					<div className="relative z-10 flex flex-1 items-center justify-center py-2">
						<div className="w-[86%] -rotate-3 rounded-2xl bg-card/85 p-4 shadow-xl ring-1 ring-border/60 backdrop-blur-sm">
							<div className="flex items-center gap-2 font-medium text-xs">
								<Mail aria-hidden="true" className="size-4 text-primary" />
								Project update
							</div>
							<div className="mt-4 space-y-2">
								<div className="h-1.5 w-4/5 rounded-full bg-foreground/15" />
								<div className="h-1.5 w-3/5 rounded-full bg-foreground/10" />
							</div>
							<div className="mt-4 flex items-center gap-2 text-[10px] text-muted-foreground">
								<AtSign
									aria-hidden="true"
									className="showcase-loop size-3.5 animate-pulse text-primary"
								/>
								claims@client.co
							</div>
						</div>
					</div>
				</ShowcaseSurface>
			);
		case "notify":
			return (
				<ShowcaseSurface>
					<ShowcaseGlow className="-bottom-10 -left-8 size-36 bg-emerald-400/25" />
					<ShowcaseMeta eyebrow="/v1/events" status="live" />
					<div className="relative z-10 mt-auto space-y-3 pt-6 pl-5">
						<div className="absolute top-8 bottom-1 left-1.5 w-px bg-gradient-to-b from-emerald-400/70 via-primary/50 to-transparent" />
						{[
							{ label: "Deploy complete", tone: "bg-emerald-500", time: "now" },
							{ label: "Payment received", tone: "bg-primary", time: "2m" },
							{ label: "Backup failed", tone: "bg-destructive", time: "8m" },
						].map(({ label, time, tone }) => (
							<div
								className="relative flex items-center gap-2 rounded-2xl bg-card/75 px-3 py-2.5 text-xs ring-1 ring-border/50"
								key={label}
							>
								<span
									className={cn(
										"showcase-loop absolute -left-[1.15rem] size-3 animate-node-pulse rounded-full ring-4 ring-card",
										tone
									)}
								/>
								<Activity
									aria-hidden="true"
									className="size-4 text-muted-foreground"
								/>
								<span className="min-w-0 flex-1 truncate">{label}</span>
								<span className="text-[10px] text-muted-foreground">
									{time}
								</span>
							</div>
						))}
					</div>
				</ShowcaseSurface>
			);
		case "os":
			return (
				<ShowcaseSurface className="min-h-52">
					<ShowcaseGlow className="-top-12 right-1/3 size-44 bg-primary/30" />
					<ShowcaseMeta eyebrow="Ryu OS" status="workspace" />
					<div className="relative z-10 flex flex-1 items-center justify-center py-3">
						<div className="showcase-loop absolute size-44 animate-glow-breathe rounded-full bg-gradient-to-br from-primary/60 via-sky-400/35 to-violet-500/40 opacity-80 shadow-[0_0_90px_theme(colors.primary/25)] blur-[1px]" />
						<div className="relative w-[82%] rounded-2xl bg-card/70 p-4 shadow-xl ring-1 ring-border/60 backdrop-blur-md">
							<div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
								<span className="size-1.5 rounded-full bg-emerald-400" />
								refactor-auth
								<span className="ml-auto">running</span>
							</div>
							<div className="mt-4 space-y-2 text-xs">
								<div className="showcase-loop w-fit animate-tool-float rounded-2xl bg-primary px-3 py-2 text-primary-foreground">
									Keep the agent moving.
								</div>
								<div className="showcase-loop w-fit animate-tool-float rounded-2xl bg-card/80 px-3 py-2 ring-1 ring-border/50">
									Workspace is ready.
								</div>
							</div>
						</div>
					</div>
				</ShowcaseSurface>
			);
		case "passport":
			return (
				<ShowcaseSurface>
					<ShowcaseGlow className="-top-8 -right-8 size-36 bg-emerald-400/25" />
					<ShowcaseMeta eyebrow="Agent identity" status="verified" />
					<div className="relative z-10 flex flex-1 items-center justify-center py-2">
						<div className="relative flex size-24 items-center justify-center rounded-full bg-gradient-to-br from-primary/25 via-card to-emerald-400/20 text-primary shadow-xl ring-1 ring-primary/30">
							<Fingerprint
								aria-hidden="true"
								className="showcase-loop size-12 animate-pulse"
								strokeWidth={1.25}
							/>
							<span className="absolute -right-1 -bottom-1 flex size-7 items-center justify-center rounded-full bg-card text-emerald-500 shadow-lg ring-1 ring-border/60">
								<ShieldCheck aria-hidden="true" className="size-4" />
							</span>
						</div>
						<div className="absolute top-1/2 left-1/2 size-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/20 border-dashed" />
					</div>
				</ShowcaseSurface>
			);
		case "share":
			return (
				<ShowcaseSurface>
					<ShowcaseGlow className="-right-10 -bottom-8 size-36 bg-cyan-400/25" />
					<ShowcaseMeta eyebrow="Node exchange" status="available" />
					<div className="relative z-10 flex flex-1 items-center justify-center py-4">
						<div className="absolute top-1/2 right-8 left-8 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
						<span className="showcase-loop absolute top-1/2 left-1/3 size-2 -translate-y-1/2 animate-flow-right rounded-full bg-primary shadow-lg shadow-primary/50" />
						<div className="flex w-full items-center justify-between">
							{[
								{ Icon: KeyRound, label: "Your node" },
								{ Icon: Network, label: "Ryu Share" },
								{ Icon: Globe2, label: "Fleet" },
							].map(({ Icon, label }, index) => (
								<div
									className="relative z-10 flex flex-col items-center gap-2"
									key={label}
								>
									<span
										className={cn(
											"flex size-12 items-center justify-center rounded-full bg-card/85 shadow-lg ring-1 backdrop-blur-sm",
											index === 1
												? "text-primary ring-primary/40"
												: "text-muted-foreground ring-border/60"
										)}
									>
										<Icon aria-hidden="true" className="size-5" />
									</span>
									<span className="text-[10px] text-muted-foreground">
										{label}
									</span>
								</div>
							))}
						</div>
					</div>
					<div className="relative z-10 flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
						<Sparkles aria-hidden="true" className="size-3.5 text-primary" />
						Idle capacity available
					</div>
				</ShowcaseSurface>
			);
		default:
			return (
				<ShowcaseSurface>
					<ShowcaseMeta eyebrow={product.label} status="ready" />
					<div className="relative z-10 mt-auto flex items-center gap-2 pt-8 text-xs">
						<Sparkles aria-hidden="true" className="size-4 text-primary" />
						<span>Ready for your workflow</span>
					</div>
				</ShowcaseSurface>
			);
	}
}

function ProductPeek({ product }: { product: ProductChoice }) {
	return (
		<div
			aria-hidden="true"
			className="h-full min-w-0"
			data-testid={`realm-visual-${product.id}`}
		>
			<ProductPeekContent product={product} />
		</div>
	);
}

function ProductCard({
	className,
	product,
}: {
	className?: string;
	product: ProductChoice;
}) {
	return (
		<article
			className={cn(
				"group relative isolate flex min-w-0 flex-col overflow-hidden rounded-3xl border border-border bg-background text-foreground transition-colors hover:border-foreground/20",
				className
			)}
		>
			<div className="relative min-h-0 flex-1 px-4 pt-4 pb-14">
				<ProductPeek product={product} />
			</div>
			<ProductExploreLink product={product} />
		</article>
	);
}

export function ProductRealmSelector() {
	return (
		<section
			aria-label="Products"
			className="text-foreground"
			data-testid="product-paths"
		>
			<div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 md:py-16 lg:px-8">
				<div
					className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:auto-rows-[minmax(8rem,auto)] xl:grid-cols-12"
					data-testid="product-bento-grid"
				>
					{FEATURED_PRODUCTS.map(({ className, Component, product }) => (
						<ProductDemoCard
							Component={Component}
							className={className}
							key={product.id}
							product={product}
						/>
					))}
					{LARGE_PRODUCTS.map((product) => (
						<ProductCard
							className="min-h-[22rem] sm:col-span-2 xl:col-span-6 xl:row-span-2"
							key={product.id}
							product={product}
						/>
					))}
					{COMPACT_PRODUCTS.map((product) => (
						<ProductCard
							className="min-h-[15rem] xl:col-span-3"
							key={product.id}
							product={product}
						/>
					))}
				</div>
			</div>
		</section>
	);
}
