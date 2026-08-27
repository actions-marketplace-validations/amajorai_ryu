"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { buttonVariants } from "@ryu/ui/components/button";
import PageHeader from "@ryu/ui/components/page-header";
import { cn } from "@ryu/ui/lib/utils";
import {
	Bot,
	CalendarClock,
	Check,
	ChevronRight,
	CircleCheck,
	Code2,
	Database,
	FileCheck2,
	LockKeyhole,
	MessageSquareText,
	Plus,
	Search,
	Settings2,
	UsersRound,
	Workflow,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { DEMO_HREF } from "./data/resources.tsx";
import ProductLandingCtas from "./product-landing-ctas.tsx";
import { ProductRealmSelector } from "./product-realm-selector.tsx";

function CrmHeroVisual() {
	const columns = [
		{
			color: "bg-sky-400",
			items: ["Northstar Labs", "Atlas Health"],
			label: "New",
		},
		{
			color: "bg-violet-400",
			items: ["Brightline", "Morrow & Co."],
			label: "Qualified",
		},
		{
			color: "bg-amber-400",
			items: ["Cedar Systems"],
			label: "Proposal",
		},
		{
			color: "bg-emerald-400",
			items: ["Lumen Group"],
			label: "Won",
		},
	] as const;

	return (
		<div
			aria-label="Harbor CRM showing a deal pipeline and a proposed custom field"
			className="overflow-hidden rounded-2xl bg-[#f7f7f5] shadow-[0_24px_70px_-30px_rgba(15,23,42,0.45)] ring-1 ring-black/10 dark:bg-[#1b1c1b] dark:ring-white/10"
			data-testid="crm-hero-visual"
			role="img"
		>
			<div className="flex items-center gap-3 border-black/10 border-b px-4 py-3 dark:border-white/10">
				<div className="flex min-w-0 items-center gap-2">
					<span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#7568df] text-white">
						<Database aria-hidden="true" className="size-3.5" />
					</span>
					<div className="min-w-0">
						<p className="truncate font-medium text-foreground/85 text-xs">
							Harbor CRM
						</p>
						<p className="text-[10px] text-foreground/45">Ryu App</p>
					</div>
				</div>
				<div className="ml-auto flex min-w-0 items-center gap-2 rounded-lg bg-black/[0.04] px-2.5 py-1.5 text-[10px] text-foreground/45 dark:bg-white/[0.07]">
					<Search aria-hidden="true" className="size-3 shrink-0" />
					<span className="truncate">Search everything…</span>
				</div>
				<span className="hidden shrink-0 items-center gap-1 rounded-full bg-[#e9e5ff] px-2 py-1 font-medium text-[#5c50b4] text-[9px] sm:inline-flex dark:bg-[#7568df]/20 dark:text-[#c4b5fd]">
					<Settings2 aria-hidden="true" className="size-3" />
					Customise
				</span>
			</div>

			<div className="grid min-h-[25rem] grid-cols-[8.5rem_minmax(0,1fr)]">
				<aside className="border-black/10 border-r bg-black/[0.025] p-3 dark:border-white/10 dark:bg-white/[0.03]">
					<p className="px-2 text-[9px] text-foreground/40 uppercase tracking-[0.16em]">
						Objects
					</p>
					<div className="mt-2 space-y-1 text-[10px]">
						<div className="flex items-center gap-2 rounded-md bg-white/80 px-2 py-1.5 font-medium text-foreground/75 dark:bg-white/10">
							<UsersRound aria-hidden="true" className="size-3" /> Contacts
						</div>
						<div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-foreground/50">
							<Database aria-hidden="true" className="size-3" /> Companies
						</div>
						<div className="flex items-center gap-2 rounded-md bg-[#ebe9ff] px-2 py-1.5 font-medium text-[#5c50b4] dark:bg-[#7568df]/20 dark:text-[#c4b5fd]">
							<Workflow aria-hidden="true" className="size-3" /> Deals
						</div>
						<div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-foreground/50">
							<CalendarClock aria-hidden="true" className="size-3" /> Tasks
						</div>
					</div>
					<div className="mt-6 border-black/10 border-t pt-3 dark:border-white/10">
						<p className="px-2 text-[9px] text-foreground/40 uppercase tracking-[0.16em]">
							Views
						</p>
						<p className="mt-2 rounded-md px-2 py-1.5 text-[10px] text-foreground/50">
							Pipeline
						</p>
						<p className="rounded-md px-2 py-1.5 text-[10px] text-foreground/50">
							All deals
						</p>
					</div>
				</aside>

				<section className="min-w-0 bg-white/70 p-3 dark:bg-white/[0.04]">
					<div className="flex items-center justify-between gap-2">
						<div>
							<p className="font-medium text-foreground/80 text-sm">Deals</p>
							<p className="text-[10px] text-foreground/40">
								Pipeline · 6 records
							</p>
						</div>
						<span className="flex items-center gap-1 rounded-md bg-foreground px-2 py-1.5 font-medium text-[10px] text-background">
							<Plus aria-hidden="true" className="size-3" /> Add record
						</span>
					</div>

					<div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
						{columns.map((column) => (
							<div className="min-w-0" key={column.label}>
								<div className="flex items-center gap-1.5 px-1 text-[10px] text-foreground/55">
									<span className={`size-1.5 rounded-full ${column.color}`} />
									<span className="truncate">{column.label}</span>
									<span className="ml-auto text-[9px] text-foreground/35">
										{column.items.length}
									</span>
								</div>
								<div className="mt-2 space-y-2">
									{column.items.map((item) => (
										<div
											className="rounded-lg border border-black/[0.06] bg-white p-2.5 shadow-sm dark:border-white/10 dark:bg-white/[0.06]"
											key={item}
										>
											<p className="truncate font-medium text-[10px] text-foreground/75">
												{item}
											</p>
											<p className="mt-2 truncate text-[9px] text-foreground/40">
												{column.label === "Won"
													? "$48,000"
													: "Next step Friday"}
											</p>
										</div>
									))}
								</div>
							</div>
						))}
					</div>

					<div className="mt-4 flex items-center gap-2 rounded-lg border border-[#cfc6ff] bg-[#f5f1ff] px-2.5 py-2 text-[10px] dark:border-[#7568df]/40 dark:bg-[#7568df]/15">
						<MessageSquareText
							aria-hidden="true"
							className="size-3.5 shrink-0 text-[#7568df]"
						/>
						<span className="min-w-0 flex-1 truncate text-[#5c50b4] dark:text-[#ddd6fe]">
							Add a renewal date field to Deals
						</span>
						<span className="shrink-0 rounded-full bg-white/80 px-2 py-1 font-medium text-[#5c50b4] text-[9px] dark:bg-white/10 dark:text-[#ddd6fe]">
							Review change
						</span>
					</div>
				</section>
			</div>
		</div>
	);
}

function AppCreationVisual() {
	const reduceMotion = useReducedMotion();
	const [phase, setPhase] = useState<"request" | "app">("request");

	useEffect(() => {
		if (reduceMotion) {
			setPhase("app");
			return;
		}
		const timer = window.setTimeout(() => setPhase("app"), 2800);
		return () => window.clearTimeout(timer);
	}, [reduceMotion]);

	return (
		<div data-testid="app-creation-visual">
			<AnimatePresence mode="wait">
				{phase === "request" ? (
					<motion.div
						animate={{ opacity: 1, y: 0 }}
						className="flex min-h-[25rem] flex-col rounded-2xl bg-[#f7f7f5] p-4 shadow-[0_24px_70px_-30px_rgba(15,23,42,0.35)] ring-1 ring-black/10 dark:bg-[#1b1c1b] dark:ring-white/10"
						initial={{ opacity: 0, y: 10 }}
						key="request"
						transition={{ duration: 0.35, ease: "easeOut" }}
					>
						<div className="flex items-center justify-between border-black/10 border-b pb-3 dark:border-white/10">
							<div>
								<p className="font-medium text-foreground/80 text-xs">
									Ask Ryu to build the app
								</p>
								<p className="mt-0.5 text-[10px] text-foreground/40">
									Start from a template, then change it by asking.
								</p>
							</div>
							<span className="rounded-full bg-[#ebe9ff] px-2 py-1 font-medium text-[#5c50b4] text-[9px] dark:bg-[#7568df]/20 dark:text-[#c4b5fd]">
								New app
							</span>
						</div>
						<div className="flex flex-1 flex-col justify-center gap-3 py-8">
							<div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-md bg-[#7568df] px-3.5 py-3 text-white text-xs leading-relaxed">
								Build a CRM for our sales team.
							</div>
							<div className="max-w-[90%] rounded-2xl rounded-tl-md bg-white px-3.5 py-3 text-foreground/75 text-xs leading-relaxed shadow-sm dark:bg-white/[0.08]">
								I’ll start with contacts, deals, pipeline stages, and
								follow-ups.
							</div>
							<div className="flex items-center gap-2 rounded-xl border border-[#cfc6ff] bg-[#f5f1ff] px-3 py-2 text-[#5c50b4] text-[10px] dark:border-[#7568df]/40 dark:bg-[#7568df]/15 dark:text-[#ddd6fe]">
								<span className="size-1.5 animate-pulse rounded-full bg-[#7568df]" />
								Generating the first version from the CRM template…
							</div>
						</div>
						<div className="flex items-center gap-2 text-[10px] text-foreground/40">
							<Workflow aria-hidden="true" className="size-3.5" />
							<span>App template · CRM</span>
						</div>
					</motion.div>
				) : (
					<motion.div
						animate={{ opacity: 1, y: 0 }}
						initial={{ opacity: 0, y: 10 }}
						key="app"
						transition={{ duration: 0.35, ease: "easeOut" }}
					>
						<div className="mb-2 flex items-center justify-between px-1 text-[10px] text-foreground/45">
							<span>App created from your request</span>
							<span className="flex items-center gap-1 font-medium text-emerald-600">
								<span className="size-1.5 rounded-full bg-emerald-500" />
								Ready to review
							</span>
						</div>
						<CrmHeroVisual />
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

function WorkflowCardVisual() {
	return (
		<div className="space-y-2.5">
			<div className="flex items-center gap-2 text-[10px] text-foreground/50 uppercase tracking-[0.14em]">
				<Workflow aria-hidden="true" className="size-3.5 text-[#8f7bf2]" />
				Example workflows
			</div>
			<div className="flex items-center gap-2 rounded-xl bg-white/60 px-2.5 py-2.5 text-[10px] dark:bg-white/[0.06]">
				<FileCheck2
					aria-hidden="true"
					className="size-3.5 shrink-0 text-emerald-600"
				/>
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-foreground/75">
						Policy Summary
					</span>
					<span className="block truncate text-foreground/40">
						Configured for your format
					</span>
				</span>
				<ChevronRight
					aria-hidden="true"
					className="size-3 shrink-0 text-foreground/25"
				/>
			</div>
			<div className="flex items-center gap-2 rounded-xl bg-white/60 px-2.5 py-2.5 text-[10px] dark:bg-white/[0.06]">
				<FileCheck2
					aria-hidden="true"
					className="size-3.5 shrink-0 text-emerald-600"
				/>
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-foreground/75">
						Claims preparation
					</span>
					<span className="block truncate text-foreground/40">
						Uses your approval steps
					</span>
				</span>
				<ChevronRight
					aria-hidden="true"
					className="size-3 shrink-0 text-foreground/25"
				/>
			</div>
			<div className="flex items-center gap-2 rounded-xl bg-white/60 px-2.5 py-2.5 text-[10px] dark:bg-white/[0.06]">
				<FileCheck2
					aria-hidden="true"
					className="size-3.5 shrink-0 text-emerald-600"
				/>
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-foreground/75">
						Invoice reconciliation
					</span>
					<span className="block truncate text-foreground/40">
						Connects your records
					</span>
				</span>
				<ChevronRight
					aria-hidden="true"
					className="size-3 shrink-0 text-foreground/25"
				/>
			</div>
		</div>
	);
}

function BotCardVisual() {
	return (
		<div className="space-y-3">
			<div className="ml-auto max-w-[88%] rounded-xl bg-white/65 px-3 py-2 text-[11px] text-foreground/60 dark:bg-white/[0.08]">
				Process the five policies that arrived today.
			</div>
			<div className="max-w-[92%] rounded-xl bg-white/55 px-3 py-3 text-[11px] text-foreground/75 leading-relaxed dark:bg-white/[0.06]">
				<p>Done. Five drafts are ready for review.</p>
				<div className="mt-3 flex flex-wrap gap-1.5">
					<span className="flex items-center gap-1.5 rounded-md bg-white/60 px-2 py-1 text-[10px] text-foreground/55 dark:bg-white/10">
						<FileCheck2 aria-hidden="true" className="size-3" /> Sources used
					</span>
					<span className="flex items-center gap-1.5 rounded-md bg-white/60 px-2 py-1 text-[10px] text-foreground/55 dark:bg-white/10">
						<Check aria-hidden="true" className="size-3" /> Ready to review
					</span>
				</div>
			</div>
		</div>
	);
}

function ConsoleCardVisual() {
	return (
		<div className="space-y-2.5">
			<div className="flex items-center justify-between rounded-xl bg-white/60 px-3 py-2.5 text-[10px] dark:bg-white/[0.06]">
				<span className="flex items-center gap-2 text-foreground/65">
					<Settings2 aria-hidden="true" className="size-3.5 text-[#f59e0b]" />
					Change proposal
				</span>
				<span className="rounded-full bg-amber-100 px-2 py-1 font-medium text-[9px] text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
					Pending
				</span>
			</div>
			<div className="rounded-xl bg-white/55 p-3 text-[10px] leading-relaxed dark:bg-white/[0.05]">
				<div className="flex items-center justify-between gap-3 py-1">
					<span className="text-foreground/40">Workflow</span>
					<span className="text-right text-foreground/70">Policy Summary</span>
				</div>
				<div className="flex items-center justify-between gap-3 py-1">
					<span className="text-foreground/40">Approval</span>
					<span className="text-right text-foreground/70">
						Manager &gt; $5,000
					</span>
				</div>
				<div className="flex items-center justify-between gap-3 py-1">
					<span className="text-foreground/40">Audit record</span>
					<span className="text-right text-foreground/70">
						Will be captured
					</span>
				</div>
			</div>
		</div>
	);
}

function ProductCard({
	children,
	description,
	href,
	icon,
	label,
	testId,
}: {
	children: ReactNode;
	description: string;
	href: string;
	icon: ReactNode;
	label: string;
	testId: string;
}) {
	return (
		<Link
			className="group flex min-h-[19rem] flex-col overflow-hidden rounded-2xl bg-muted/50 p-4 transition-colors hover:bg-muted/70 md:p-5"
			data-testid={testId}
			href={href as Route}
		>
			<div className="flex items-center gap-2 text-foreground/75 text-sm">
				{icon}
				<span>{label}</span>
			</div>
			<p className="mt-2 max-w-xs text-muted-foreground text-xs leading-relaxed">
				{description}
			</p>
			<div className="relative min-h-0 flex-1 overflow-hidden pt-5">
				<div className="transition-transform duration-500 ease-out group-hover:scale-[1.035]">
					{children}
				</div>
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-muted/70 via-muted/25 to-transparent blur-[1px]"
				/>
			</div>
			<div className="flex items-center justify-between pt-5 text-muted-foreground text-xs">
				<span>Explore</span>
				<HugeiconsIcon
					aria-hidden="true"
					className="size-4 transition-transform duration-300 group-hover:translate-x-0.5"
					icon={ArrowRight01Icon}
				/>
			</div>
		</Link>
	);
}

export default function RealmsHero() {
	return (
		<main className="bg-background text-foreground" data-testid="realms-hero">
			<section className="mx-auto max-w-6xl px-6 pt-16 pb-20 md:pt-24 md:pb-24">
				<div className="max-w-2xl">
					<PageHeader
						className="max-w-xl"
						title={
							<>
								Ryu is AI-native business software.
								<br />
								Ask Ryu to customise it.
							</>
						}
					/>

					<div className="mt-8 flex flex-col gap-3 sm:flex-row">
						<Link
							className={cn(buttonVariants(), "rounded-full")}
							href="/marketplace"
						>
							Explore Ryu Apps
						</Link>
						<a
							className={cn(
								buttonVariants({ variant: "outline" }),
								"rounded-full"
							)}
							href={DEMO_HREF}
							rel="noopener noreferrer"
							target="_blank"
						>
							Book a Demo
						</a>
					</div>
				</div>

				<div className="mx-auto mt-16 max-w-5xl">
					<AppCreationVisual />
				</div>

				<div className="mx-auto mt-12 max-w-5xl">
					<ProductRealmSelector />
				</div>

				<div className="mt-14 grid gap-3 pt-6 text-sm sm:grid-cols-3">
					<div className="flex gap-3">
						<CircleCheck
							aria-hidden="true"
							className="mt-0.5 size-4 shrink-0 text-emerald-600"
						/>
						<div>
							<p className="font-medium text-foreground/80">
								Useful on day one
							</p>
							<p className="mt-1 text-muted-foreground text-xs leading-relaxed">
								Start from a process your team already runs.
							</p>
						</div>
					</div>
					<div className="flex gap-3">
						<MessageSquareText
							aria-hidden="true"
							className="mt-0.5 size-4 shrink-0 text-[#8f7bf2]"
						/>
						<div>
							<p className="font-medium text-foreground/80">
								Adaptable by conversation
							</p>
							<p className="mt-1 text-muted-foreground text-xs leading-relaxed">
								Tell Ryu what to change in the form, rule, or handoff.
							</p>
						</div>
					</div>
					<div className="flex gap-3">
						<LockKeyhole
							aria-hidden="true"
							className="mt-0.5 size-4 shrink-0 text-[#d97706]"
						/>
						<div>
							<p className="font-medium text-foreground/80">
								Governed before publish
							</p>
							<p className="mt-1 text-muted-foreground text-xs leading-relaxed">
								Ryu keeps permissions, budgets, and audit history in place.
							</p>
						</div>
					</div>
				</div>
			</section>

			<section className="border-muted border-t bg-muted/20" id="how-it-works">
				<div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
					<div className="max-w-2xl">
						<p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.18em]">
							The product loop
						</p>
						<h2 className="mt-4 text-balance font-medium text-4xl text-foreground leading-tight tracking-[-0.04em] md:text-5xl">
							Start with a working workflow. Change it as your operation
							changes.
						</h2>
						<p className="mt-5 max-w-xl text-muted-foreground leading-relaxed">
							Each app starts with a focused workflow. Describe a new rule,
							view, or integration and Ryu prepares a reviewable proposal.
						</p>
					</div>

					<div className="mt-12 grid gap-3 md:grid-cols-3">
						<div className="rounded-2xl bg-background p-5 ring-1 ring-black/[0.06] dark:ring-white/[0.08]">
							<FileCheck2
								aria-hidden="true"
								className="size-5 text-foreground/70"
							/>
							<h3 className="mt-7 font-medium text-foreground text-lg tracking-tight">
								Pick a workflow
							</h3>
							<p className="mt-2 text-muted-foreground text-sm leading-relaxed">
								Choose an app built around a process your team already runs.
							</p>
						</div>
						<div className="rounded-2xl bg-background p-5 ring-1 ring-black/[0.06] dark:ring-white/[0.08]">
							<MessageSquareText
								aria-hidden="true"
								className="size-5 text-foreground/70"
							/>
							<h3 className="mt-7 font-medium text-foreground text-lg tracking-tight">
								Describe what should change
							</h3>
							<p className="mt-2 text-muted-foreground text-sm leading-relaxed">
								Tell Ryu which form, approval rule, record source, or view to
								change.
							</p>
						</div>
						<div className="rounded-2xl bg-background p-5 ring-1 ring-black/[0.06] dark:ring-white/[0.08]">
							<LockKeyhole
								aria-hidden="true"
								className="size-5 text-foreground/70"
							/>
							<h3 className="mt-7 font-medium text-foreground text-lg tracking-tight">
								Review, then publish
							</h3>
							<p className="mt-2 text-muted-foreground text-sm leading-relaxed">
								Review the proposal, test it, and publish it when it is ready.
							</p>
						</div>
					</div>
				</div>
			</section>

			<section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
				<div className="grid items-center gap-8 rounded-[2rem] bg-[#16151a] px-6 py-8 text-white md:grid-cols-[1fr_auto] md:px-10 md:py-10">
					<div>
						<p className="font-medium text-white/55 text-xs uppercase tracking-[0.18em]">
							One Ryu subscription
						</p>
						<h2 className="mt-3 max-w-2xl text-balance font-medium text-3xl leading-tight tracking-[-0.04em] md:text-4xl">
							Add the next workflow without adding another system.
						</h2>
						<p className="mt-4 max-w-xl text-sm text-white/60 leading-relaxed">
							Start with one workflow. Add the next one under the same
							subscription, with Bot, Console, permissions, approvals, audit
							history, and shared usage.
						</p>
					</div>
					<div className="md:min-w-52 md:text-right">
						<p className="font-medium text-4xl tracking-[-0.05em]">$250</p>
						<p className="mt-1 text-sm text-white/55">
							per month for five member seats
						</p>
						<Link
							className={cn(
								buttonVariants({ variant: "secondary" }),
								"mt-5 rounded-full bg-white text-[#16151a] hover:bg-white/90"
							)}
							href="/pricing"
						>
							View plans
						</Link>
					</div>
				</div>
			</section>

			<section className="border-muted border-t">
				<div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
					<div className="max-w-2xl">
						<p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.18em]">
							The rest of Ryu
						</p>
						<h2 className="mt-4 text-balance font-medium text-4xl text-foreground leading-tight tracking-[-0.04em] md:text-5xl">
							The app handles the work. Bot and Console keep you in control.
						</h2>
						<p className="mt-5 max-w-xl text-muted-foreground leading-relaxed">
							Apps run the workflow. Bot takes requests. Console lets people
							review changes and manage access.
						</p>
					</div>

					<div className="mt-12 grid gap-3 md:grid-cols-3">
						<ProductCard
							description="Change its forms, rules, and handoffs as your process changes."
							href="/marketplace"
							icon={<Workflow className="size-4 text-[#8f7bf2]" />}
							label="Ryu Apps"
							testId="realm-card-apps"
						>
							<WorkflowCardVisual />
						</ProductCard>
						<ProductCard
							description="Send the task in plain language. Bot runs it and returns a result for review."
							href="/bot"
							icon={<Bot className="size-4 text-[#a78bfa]" />}
							label="Ryu Bot"
							testId="realm-card-bot"
						>
							<BotCardVisual />
						</ProductCard>
						<ProductCard
							description="Review proposals, set permissions, and control what the app can do."
							href="/console"
							icon={<Settings2 className="size-4 text-[#fbbf24]" />}
							label="Ryu Console"
							testId="realm-card-console"
						>
							<ConsoleCardVisual />
						</ProductCard>
					</div>

					<div className="mt-8 flex flex-col gap-3 rounded-2xl border border-dashed px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
						<p className="text-muted-foreground">
							For builders: use Ryu underneath your own AI product.
						</p>
						<Link
							className="inline-flex items-center gap-2 font-medium text-foreground text-sm underline-offset-4 hover:underline"
							href="/platform"
						>
							Explore Ryu Platform
							<Code2 aria-hidden="true" className="size-3.5" />
						</Link>
					</div>
				</div>
			</section>

			<section className="border-muted border-t">
				<div className="mx-auto flex max-w-6xl flex-col items-center px-6 py-20 text-center md:py-28">
					<p className="max-w-2xl text-balance font-medium text-3xl text-foreground leading-tight tracking-[-0.04em] md:text-5xl">
						Start with the workflow your team already runs.
					</p>
					<ProductLandingCtas className="mt-8" />
				</div>
			</section>
		</main>
	);
}
