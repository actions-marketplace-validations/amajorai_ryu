"use client";

import { cn } from "@ryu/ui/lib/utils";
import { ArrowRight } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Route } from "next";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import {
	PRODUCT_HIERARCHY,
	type ProductHierarchyRealm,
} from "./data/product-hierarchy.ts";
import {
	LANDING_CARD_TONES,
	landingCardSurfaceClass,
} from "./landing-card-tones.ts";

function VisualFrame({ children }: { children: ReactNode }) {
	return (
		<div className="relative min-h-52 overflow-hidden rounded-xl border border-black/10 bg-white/60 p-4 dark:border-white/10 dark:bg-black/10">
			{children}
		</div>
	);
}

function SdkVisual({ reduceMotion }: { reduceMotion: boolean }) {
	return (
		<VisualFrame>
			<div className="flex items-center justify-between border-black/10 border-b pb-3 font-mono text-[10px] text-foreground/55 dark:border-white/10">
				<span>agent.ts</span>
				<span>SDK</span>
			</div>
			<div className="relative mt-4 space-y-2 overflow-hidden font-mono text-[11px] leading-relaxed">
				<motion.div
					animate={reduceMotion ? { x: "0%" } : { x: ["-140%", "340%"] }}
					aria-hidden="true"
					className="pointer-events-none absolute inset-y-0 w-1/3 bg-blue-400/20 blur-xl"
					transition={{
						duration: 2.8,
						ease: "linear",
						repeat: Number.POSITIVE_INFINITY,
					}}
				/>
				<div className="text-foreground/45">
					01&nbsp; import &#123; defineAgent &#125;
				</div>
				<div className="rounded-md bg-blue-500/10 px-2 py-1 text-blue-900 dark:text-blue-200">
					02&nbsp; const agent = defineAgent&#40;&#123; tools, model &#125;&#41;
				</div>
				<div className="text-foreground/45">
					03&nbsp; agent.run&#40;request&#41;
				</div>
				<div className="flex items-center gap-2 pt-2 text-foreground/60">
					<span className="size-1.5 rounded-full bg-blue-500" />
					governed by Gateway
				</div>
			</div>
		</VisualFrame>
	);
}

function CoreVisual({ reduceMotion }: { reduceMotion: boolean }) {
	const capabilities = ["Models", "Agents", "Tools", "Memory", "Workflows"];

	return (
		<VisualFrame>
			<div className="flex items-center justify-between text-[10px] text-foreground/55">
				<span className="font-mono">CORE / RUN</span>
				<span className="inline-flex items-center gap-1.5">
					<span className="size-1.5 rounded-full bg-purple-500" />
					active
				</span>
			</div>
			<div className="mt-4 grid gap-2">
				{capabilities.map((capability, index) => (
					<motion.div
						animate={
							reduceMotion
								? { opacity: 1, x: 0 }
								: { opacity: [0.5, 1, 0.5], x: [0, 3, 0] }
						}
						className="flex items-center justify-between rounded-lg border border-purple-900/10 bg-purple-500/10 px-3 py-2 text-purple-950 text-xs dark:border-purple-200/10 dark:text-purple-100"
						key={capability}
						transition={{
							duration: 2.2,
							delay: index * 0.22,
							ease: "easeInOut",
							repeat: Number.POSITIVE_INFINITY,
						}}
					>
						<span>{capability}</span>
						<span className="font-mono text-[10px] text-purple-900/55 dark:text-purple-100/55">
							ready
						</span>
					</motion.div>
				))}
			</div>
		</VisualFrame>
	);
}

function DeployVisual({ reduceMotion }: { reduceMotion: boolean }) {
	return (
		<VisualFrame>
			<div className="flex items-center justify-between text-[10px] text-foreground/55">
				<span className="font-mono">DEPLOY / CLOUD</span>
				<span>managed runtime</span>
			</div>
			<div className="relative mt-9 flex items-center justify-between gap-3">
				<div className="absolute top-1/2 right-8 left-8 h-px bg-orange-900/20 dark:bg-orange-100/20" />
				<motion.div
					animate={
						reduceMotion ? { left: "50%" } : { left: ["12%", "88%", "12%"] }
					}
					aria-hidden="true"
					className="absolute top-1/2 left-8 z-10 size-2 -translate-y-1/2 rounded-full bg-orange-600 shadow-[0_0_0_5px_rgba(234,88,12,0.12)] dark:bg-orange-300"
					transition={{
						duration: 3.2,
						ease: "easeInOut",
						repeat: Number.POSITIVE_INFINITY,
					}}
				/>
				{["Code", "Core", "Cloud"].map((stage) => (
					<div
						className="relative z-0 flex size-14 items-center justify-center rounded-xl border border-orange-900/15 bg-orange-500/15 text-center text-[10px] text-orange-950 dark:border-orange-100/15 dark:text-orange-100"
						key={stage}
					>
						{stage}
					</div>
				))}
			</div>
			<div className="mt-7 flex items-center justify-between font-mono text-[10px] text-orange-900/60 dark:text-orange-100/60">
				<span>deploy → run → keep live</span>
				<span>cloud</span>
			</div>
		</VisualFrame>
	);
}

function GatewayVisual({ reduceMotion }: { reduceMotion: boolean }) {
	return (
		<VisualFrame>
			<div className="flex items-center justify-between text-[10px] text-foreground/55">
				<span className="font-mono">GATEWAY / SECURE</span>
				<span>one endpoint</span>
			</div>
			<div className="relative mt-6 flex items-center gap-2">
				<div className="rounded-lg border border-orange-900/15 bg-orange-500/10 px-2.5 py-2 text-center text-[10px] text-orange-950 dark:border-orange-100/15 dark:text-orange-100">
					Your agent
				</div>
				<div className="relative h-px flex-1 bg-orange-900/20 dark:bg-orange-100/20">
					<motion.span
						animate={reduceMotion ? { left: "50%" } : { left: ["0%", "100%"] }}
						aria-hidden="true"
						className="absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-orange-600 dark:bg-orange-300"
						transition={{
							duration: 1.5,
							ease: "linear",
							repeat: Number.POSITIVE_INFINITY,
						}}
					/>
				</div>
				<div className="rounded-lg bg-orange-600 px-2.5 py-2 text-center font-medium text-[10px] text-white dark:bg-orange-300 dark:text-orange-950">
					Gateway
				</div>
			</div>
			<div className="mt-5 grid grid-cols-3 gap-2">
				{["Access", "Spend", "Provider"].map((control) => (
					<div
						className="rounded-md border border-orange-900/10 bg-orange-500/10 px-2 py-2 text-center text-[10px] text-orange-950 dark:border-orange-100/10 dark:text-orange-100"
						key={control}
					>
						{control}
					</div>
				))}
			</div>
		</VisualFrame>
	);
}

function BotVisual({ reduceMotion }: { reduceMotion: boolean }) {
	const messages = [
		{ body: "Summarize this week's work.", role: "You" },
		{ body: "I found 9 shipped issues and 2 in progress.", role: "Ryu" },
	];

	return (
		<VisualFrame>
			<div className="flex items-center justify-between text-[10px] text-foreground/55">
				<span className="font-mono">BOT / CHAT</span>
				<span className="text-teal-800 dark:text-teal-200">online</span>
			</div>
			<div className="mt-4 space-y-2.5">
				{messages.map((message, index) => (
					<motion.div
						animate={
							reduceMotion
								? { opacity: 1, x: 0 }
								: { opacity: [0.6, 1, 0.6], x: [0, index === 0 ? 2 : -2, 0] }
						}
						className={cn(
							"max-w-[88%] rounded-xl border px-3 py-2 text-xs",
							index === 0
								? "ml-auto border-teal-900/10 bg-teal-500/15 text-teal-950 dark:border-teal-100/10 dark:text-teal-100"
								: "border-black/10 bg-white/50 text-foreground/70 dark:border-white/10 dark:bg-black/10"
						)}
						key={message.body}
						transition={{
							duration: 2.4,
							delay: index * 0.35,
							ease: "easeInOut",
							repeat: Number.POSITIVE_INFINITY,
						}}
					>
						<span className="mb-1 block font-mono text-[10px] opacity-55">
							{message.role}
						</span>
						{message.body}
					</motion.div>
				))}
			</div>
			<div className="mt-4 flex items-center gap-1.5 font-mono text-[10px] text-teal-900/60 dark:text-teal-100/60">
				<span className="size-1.5 animate-pulse rounded-full bg-teal-600 dark:bg-teal-300" />
				Ryu is typing
			</div>
		</VisualFrame>
	);
}

function ConsoleVisual({ reduceMotion }: { reduceMotion: boolean }) {
	const settings = [
		{ enabled: true, label: "Model access" },
		{ enabled: true, label: "Tool approvals" },
		{ enabled: false, label: "Cloud fallback" },
	];

	return (
		<VisualFrame>
			<div className="flex items-center justify-between text-[10px] text-foreground/55">
				<span className="font-mono">CONSOLE / CONFIGURE</span>
				<span>workspace settings</span>
			</div>
			<div className="mt-4 space-y-2">
				{settings.map((setting, index) => (
					<motion.div
						animate={
							reduceMotion
								? { opacity: 1, x: 0 }
								: { opacity: [0.55, 1, 0.55], x: [0, 2, 0] }
						}
						className="flex items-center justify-between rounded-lg border border-pink-900/10 bg-pink-500/10 px-3 py-2.5 text-pink-950 text-xs dark:border-pink-100/10 dark:text-pink-100"
						key={setting.label}
						transition={{
							duration: 2.6,
							delay: index * 0.28,
							ease: "easeInOut",
							repeat: Number.POSITIVE_INFINITY,
						}}
					>
						<span>{setting.label}</span>
						<span
							className={cn(
								"rounded-full px-2 py-0.5 font-mono text-[10px]",
								setting.enabled
									? "bg-pink-600/15 text-pink-800 dark:bg-pink-300/15 dark:text-pink-100"
									: "bg-black/5 text-foreground/45 dark:bg-white/10"
							)}
						>
							{setting.enabled ? "on" : "off"}
						</span>
					</motion.div>
				))}
			</div>
		</VisualFrame>
	);
}

function AppsVisual({ reduceMotion }: { reduceMotion: boolean }) {
	const apps = ["Inbox triage", "Weekly update", "Receipt review"];

	return (
		<VisualFrame>
			<div className="flex items-center justify-between text-[10px] text-foreground/55">
				<span className="font-mono">APPS / CATALOG</span>
				<span>ready-made</span>
			</div>
			<div className="mt-5 overflow-hidden">
				<motion.div
					animate={reduceMotion ? { x: 0 } : { x: [0, -92, -184, 0] }}
					className="flex w-max gap-2"
					transition={{
						duration: 5.5,
						ease: "easeInOut",
						repeat: Number.POSITIVE_INFINITY,
					}}
				>
					{apps.map((app, index) => (
						<div
							className="flex h-28 w-32 shrink-0 flex-col justify-between rounded-xl border border-green-900/10 bg-green-500/10 p-3 text-green-950 dark:border-green-100/10 dark:text-green-100"
							key={app}
						>
							<span className="flex size-7 items-center justify-center rounded-lg bg-green-600/15 font-medium text-xs dark:bg-green-300/15">
								{index + 1}
							</span>
							<span className="text-[10px] leading-tight">{app}</span>
						</div>
					))}
				</motion.div>
			</div>
		</VisualFrame>
	);
}

function ProductHierarchyVisual({ realm }: { realm: ProductHierarchyRealm }) {
	const reduceMotion = useReducedMotion() ?? false;

	return (
		<div aria-label={`${realm.label} visualization`} role="img">
			<AnimatePresence initial={false} mode="wait">
				<motion.div
					animate={{ opacity: 1, y: 0 }}
					initial={{ opacity: 0, y: 8 }}
					key={realm.id}
					transition={{ duration: reduceMotion ? 0 : 0.2 }}
				>
					{realm.id === "sdk" ? (
						<SdkVisual reduceMotion={reduceMotion} />
					) : null}
					{realm.id === "core" ? (
						<CoreVisual reduceMotion={reduceMotion} />
					) : null}
					{realm.id === "deploy" ? (
						<DeployVisual reduceMotion={reduceMotion} />
					) : null}
					{realm.id === "gateway" ? (
						<GatewayVisual reduceMotion={reduceMotion} />
					) : null}
					{realm.id === "bot" ? (
						<BotVisual reduceMotion={reduceMotion} />
					) : null}
					{realm.id === "console" ? (
						<ConsoleVisual reduceMotion={reduceMotion} />
					) : null}
					{realm.id === "apps" ? (
						<AppsVisual reduceMotion={reduceMotion} />
					) : null}
				</motion.div>
			</AnimatePresence>
		</div>
	);
}

/** The product hierarchy selector and its looping realm visualisations. */
export function ProductRealmSelector() {
	const [selectedId, setSelectedId] = useState(PRODUCT_HIERARCHY[0].id);
	const selected =
		PRODUCT_HIERARCHY.find((realm) => realm.id === selectedId) ??
		PRODUCT_HIERARCHY[0];
	const SelectedIcon = selected.icon;
	const selectedTone = LANDING_CARD_TONES[selected.tone];

	return (
		<section
			aria-labelledby="product-realm-selector-title"
			className="rounded-[2rem] border border-border/70 bg-muted/20 p-3 shadow-[0_24px_70px_-48px_rgba(15,23,42,0.55)] md:p-4"
			data-testid="product-realm-selector"
		>
			<div className="flex flex-col gap-3 px-2 pt-1 md:flex-row md:items-end md:justify-between md:px-3">
				<div>
					<h2
						className="font-medium text-2xl text-foreground tracking-[-0.04em]"
						id="product-realm-selector-title"
					>
						Ryu
					</h2>
					<p className="mt-1 text-muted-foreground text-sm">
						AI deployment platform
					</p>
				</div>
				<span className="w-fit rounded-full border border-border bg-background px-3 py-1 font-mono text-[11px] text-muted-foreground">
					Deploy = Cloud
				</span>
			</div>

			<div
				aria-label="Ryu product layers"
				className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-3"
				role="tablist"
			>
				{PRODUCT_HIERARCHY.map((realm) => {
					const Icon = realm.icon;
					const isSelected = realm.id === selected.id;
					const tone = LANDING_CARD_TONES[realm.tone];
					return (
						<button
							aria-controls="product-realm-selector-panel"
							aria-selected={isSelected}
							className={cn(
								"group flex min-h-16 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
								isSelected
									? cn(tone.surface, tone.title, "border-transparent shadow-sm")
									: "border-transparent bg-background/70 text-foreground/65 hover:bg-background hover:text-foreground"
							)}
							data-active={isSelected ? "true" : "false"}
							data-testid={`product-realm-tab-${realm.id}`}
							id={`product-realm-tab-${realm.id}`}
							key={realm.id}
							onClick={() => setSelectedId(realm.id)}
							role="tab"
							type="button"
						>
							<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background/70 text-current">
								<Icon aria-hidden="true" className="size-4" />
							</span>
							<span className="min-w-0">
								<span className="block truncate font-medium text-sm">
									{realm.label}
								</span>
								<span className="mt-0.5 block truncate font-mono text-[10px] opacity-65">
									{realm.group} · {realm.verb}
								</span>
							</span>
						</button>
					);
				})}
			</div>

			<div
				aria-labelledby={`product-realm-tab-${selected.id}`}
				className={cn(
					"mt-2 grid gap-5 rounded-[1.5rem] md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:items-center",
					landingCardSurfaceClass(selected.tone)
				)}
				data-testid="product-realm-selector-panel"
				id="product-realm-selector-panel"
				role="tabpanel"
			>
				<div className="flex flex-col items-start">
					<span className="flex size-10 items-center justify-center rounded-xl bg-background/70">
						<SelectedIcon aria-hidden="true" className="size-5" />
					</span>
					<p className={cn("mt-5 font-mono text-xs", selectedTone.title)}>
						{selected.group} · {selected.label} = {selected.verb}
					</p>
					<h3
						className={cn(
							"mt-2 font-medium text-2xl tracking-[-0.04em]",
							selectedTone.title
						)}
					>
						{selected.label}
					</h3>
					<p className={cn("mt-3 text-sm leading-relaxed", selectedTone.body)}>
						{selected.description}
					</p>
					<Link
						className={cn(
							"mt-6 inline-flex items-center gap-1.5 font-medium text-sm underline-offset-4 hover:underline",
							selectedTone.ctaSecondary
						)}
						href={selected.href as Route}
					>
						{selected.verb} {selected.label}
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</div>
				<ProductHierarchyVisual realm={selected} />
			</div>
		</section>
	);
}
