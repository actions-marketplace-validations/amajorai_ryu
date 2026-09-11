import { cn } from "@ryu/ui/lib/utils";
import { ArrowUpRight, Store } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { PRODUCT_REALMS } from "./data/product-realms.ts";

const PRODUCT_BENTO_ITEMS = [
	{
		description:
			"Install focused tools for research, documents, and business workflows.",
		href: "/marketplace/apps",
		icon: Store,
		id: "apps",
		label: "Ryu Apps",
		span: "lg:col-span-2",
	},
	...PRODUCT_REALMS.map((realm) => ({
		...realm,
		span:
			realm.id === "console"
				? "lg:col-span-2"
				: realm.id === "hire"
					? "lg:col-span-2"
					: "lg:col-span-1",
	})),
];

export function ProductRealmSelector() {
	return (
		<section
			aria-label="Ryu products"
			className="space-y-8"
			data-testid="product-realm-selector"
		>
			<div className="max-w-2xl">
				<h2 className="font-heading font-medium text-3xl tracking-tight md:text-4xl">
					One platform. Every surface.
				</h2>
				<p className="mt-4 text-muted-foreground leading-relaxed">
					Choose the Ryu product that fits the work, then connect it to the rest
					of your stack when you need more reach.
				</p>
			</div>

			<div
				className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
				data-testid="product-bento-grid"
			>
				{PRODUCT_BENTO_ITEMS.map((product) => {
					const Icon = product.icon;
					return (
						<Link
							className={cn(
								"group relative flex min-h-64 min-w-0 flex-col justify-between overflow-hidden rounded-3xl bg-muted/35 p-6 outline-offset-4 transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring md:p-7",
								product.span
							)}
							data-testid={`realm-card-${product.id}`}
							href={product.href as Route}
							key={product.id}
						>
							<div className="flex items-start justify-between gap-4">
								<div className="flex size-11 items-center justify-center rounded-2xl bg-background text-foreground shadow-sm">
									<Icon
										aria-hidden="true"
										className="size-5"
										strokeWidth={1.75}
									/>
								</div>
								<ArrowUpRight
									aria-hidden="true"
									className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
								/>
							</div>
							<div className="max-w-xl">
								<h3 className="font-heading font-medium text-2xl tracking-tight">
									{product.label}
								</h3>
								<p className="mt-2 max-w-lg text-muted-foreground text-sm leading-relaxed">
									{product.description}
								</p>
							</div>
						</Link>
					);
				})}
			</div>
		</section>
	);
}
