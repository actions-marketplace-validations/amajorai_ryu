import { cn } from "@ryu/ui/lib/utils";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import {
	type Product,
	productCategories,
	products,
	productsByCategory,
} from "./data/products.tsx";
import { landingSurfaceCardXlClass } from "./landing-card-tones.ts";
import { Reveal } from "./reveal.tsx";

function ProductCard({
	product,
	featured,
}: {
	product: Product;
	featured?: boolean;
}) {
	return (
		<Link
			className={cn(
				"group flex flex-col gap-4",
				landingSurfaceCardXlClass,
				featured && "md:col-span-2 md:row-span-1"
			)}
			href={`/products/${product.slug}`}
		>
			{featured && product.overviewVisual ? (
				<div className="min-h-0 flex-1">{product.overviewVisual}</div>
			) : null}
			<div className="flex items-start justify-between gap-3">
				<ArrowUpRight
					aria-hidden="true"
					className="size-4 text-muted-foreground transition-colors group-hover:text-foreground"
				/>
			</div>
			<div>
				<h3 className="font-medium text-base text-foreground">
					{product.name}
				</h3>
				<p className="mt-1 text-muted-foreground text-sm leading-relaxed">
					{product.tagline}
				</p>
			</div>
		</Link>
	);
}

export function ProductsOverview({
	showCategoryHeadings = true,
}: {
	showCategoryHeadings?: boolean;
}) {
	if (!showCategoryHeadings) {
		return (
			<div className="grid grid-cols-1 gap-x-12 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
				{products.map((p, i) => (
					<Reveal delay={(i % 3) * 0.06} key={p.slug}>
						<ProductCard product={p} />
					</Reveal>
				))}
			</div>
		);
	}

	return (
		<div className="space-y-16">
			{productCategories.map((category) => (
				<div key={category}>
					<h2 className="mb-6 font-heading font-medium text-2xl tracking-tight">
						{category}
					</h2>
					<div className="grid grid-cols-1 gap-x-12 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
						{productsByCategory(category).map((p, i) => (
							<Reveal delay={(i % 3) * 0.06} key={p.slug}>
								<ProductCard product={p} />
							</Reveal>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
