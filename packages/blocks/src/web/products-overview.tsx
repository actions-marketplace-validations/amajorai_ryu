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
import { AgentsVisual, CoreVisual, ToolGatewayVisual } from "./visuals.tsx";

function ProductCard({
	product,
	featured,
}: {
	product: Product;
	featured?: boolean;
}) {
	const preview =
		product.slug === "console" ? (
			<CoreVisual />
		) : product.slug === "bot" ? (
			<AgentsVisual />
		) : product.slug === "gateway" ? (
			<ToolGatewayVisual />
		) : (
			product.hero.visual
		);
	return (
		<article
			className={cn(
				"group flex flex-col gap-4",
				landingSurfaceCardXlClass,
				featured && "md:col-span-2 md:row-span-1"
			)}
		>
			{product.hero.visual ? (
				<div
					aria-hidden="true"
					className="flex h-64 items-center overflow-hidden bg-muted/40 p-6 [&>*]:w-full"
					data-product-visual
					inert
				>
					{product.overviewVisual ?? preview}
				</div>
			) : null}

			<div>
				<h3 className="font-medium text-base text-foreground">
					<Link
						className="flex items-center justify-between gap-4 outline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
						href={`/products/${product.slug}`}
					>
						{product.name}
						<ArrowUpRight
							aria-hidden="true"
							className="size-4 text-muted-foreground"
						/>
					</Link>
				</h3>
				<p className="mt-1 text-muted-foreground text-sm leading-relaxed">
					{product.tagline}
				</p>
			</div>
		</article>
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
