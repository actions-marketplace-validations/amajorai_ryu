"use client";

import { ArrowRight, Check, Sparkles } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { PRODUCT_REALMS } from "./data/product-realms.ts";

/**
 * A compact product switcher for the public landing page. It is deliberately
 * a tablist rather than a carousel: all product names stay visible, while the
 * selected panel gives the visitor one clear next action.
 */
export function ProductRealmSelector() {
	const [selectedId, setSelectedId] = useState(PRODUCT_REALMS[0].id);
	const selected =
		PRODUCT_REALMS.find((realm) => realm.id === selectedId) ??
		PRODUCT_REALMS[0];
	const SelectedIcon = selected.icon;

	return (
		<section
			aria-labelledby="product-realm-selector-title"
			className="rounded-[2rem] border border-border/70 bg-muted/20 p-3 shadow-[0_24px_70px_-48px_rgba(15,23,42,0.55)] md:p-4"
			data-testid="product-realm-selector"
		>
			<div className="flex flex-col gap-4 px-2 pt-1 md:flex-row md:items-end md:justify-between md:px-3">
				<div>
					<p className="flex items-center gap-2 font-medium text-muted-foreground text-xs uppercase tracking-[0.18em]">
						<Sparkles aria-hidden="true" className="size-3.5 text-[#8f7bf2]" />
						The Ryu product realm
					</p>
					<h2
						className="mt-2 font-medium text-2xl text-foreground tracking-[-0.04em]"
						id="product-realm-selector-title"
					>
						Choose how you want to use Ryu.
					</h2>
				</div>
				<p className="max-w-xs text-muted-foreground text-xs leading-relaxed md:text-right">
					One runtime, distinct entry points for using, operating, and building
					with agents.
				</p>
			</div>

			<div
				aria-label="Ryu products"
				className="mt-5 grid grid-cols-2 gap-1.5 md:grid-cols-3"
				role="tablist"
			>
				{PRODUCT_REALMS.map((realm) => {
					const Icon = realm.icon;
					const isSelected = realm.id === selected.id;
					return (
						<button
							aria-controls="product-realm-selector-panel"
							aria-selected={isSelected}
							className={`group flex min-h-16 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${isSelected ? "bg-foreground text-background shadow-sm" : "text-foreground/65 hover:bg-background/80 hover:text-foreground"}`}
							data-active={isSelected ? "true" : "false"}
							data-testid={`product-realm-tab-${realm.id}`}
							id={`product-realm-tab-${realm.id}`}
							key={realm.id}
							onClick={() => setSelectedId(realm.id)}
							role="tab"
							type="button"
						>
							<span
								className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${isSelected ? "bg-background/15 text-background" : "bg-background text-foreground/60 group-hover:text-foreground"}`}
							>
								<Icon aria-hidden="true" className="size-4" />
							</span>
							<span className="min-w-0">
								<span className="block truncate font-medium text-sm">
									{realm.label}
								</span>
								<span
									className={`mt-0.5 block text-[10px] ${isSelected ? "text-background/60" : "text-muted-foreground"}`}
								>
									{realm.type === "service"
										? "Standalone service"
										: "Ryu workspace"}
								</span>
							</span>
						</button>
					);
				})}
			</div>

			<div
				aria-labelledby={`product-realm-tab-${selected.id}`}
				className="mt-2 flex flex-col gap-5 rounded-[1.5rem] bg-background p-5 md:flex-row md:items-center md:justify-between md:p-6"
				data-testid="product-realm-selector-panel"
				id="product-realm-selector-panel"
				role="tabpanel"
			>
				<div className="flex items-start gap-3">
					<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#ebe9ff] text-[#5c50b4] dark:bg-[#7568df]/20 dark:text-[#c4b5fd]">
						<SelectedIcon aria-hidden="true" className="size-5" />
					</span>
					<div>
						<p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
							{selected.type === "service" ? "Standalone service" : "Workspace"}
						</p>
						<h3 className="mt-1 font-medium text-2xl text-foreground tracking-[-0.04em]">
							{selected.label}
						</h3>
						<p className="mt-2 max-w-xl text-muted-foreground text-sm leading-relaxed">
							{selected.description}
						</p>
					</div>
				</div>
				<Link
					className="inline-flex shrink-0 items-center gap-2 font-medium text-foreground text-sm underline-offset-4 hover:underline"
					href={selected.href as Route}
				>
					Explore {selected.shortLabel}
					{selected.id === "hire" ? (
						<Check aria-hidden="true" className="size-4" />
					) : (
						<ArrowRight aria-hidden="true" className="size-4" />
					)}
				</Link>
			</div>
		</section>
	);
}
