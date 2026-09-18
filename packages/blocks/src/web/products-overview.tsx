import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import {
	type Product,
	productCategories,
	products,
	productsByCategory,
} from "./data/products.tsx";
import { Reveal } from "./reveal.tsx";

function ProductCard({ product }: { product: Product }) {
	const Icon = product.Icon;
	return (
		<article className="group min-w-0 border-border border-t py-5">
			<Link
				className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-4 outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
				href={`/products/${product.slug}`}
			>
				<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
					<Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
				</span>
				<span className="min-w-0">
					<span className="block font-medium text-base text-foreground group-hover:underline group-hover:underline-offset-4">
						{product.name}
					</span>
					<span className="mt-1 block text-muted-foreground text-sm leading-relaxed">
						{product.tagline}
					</span>
				</span>
				<ArrowUpRight
					aria-hidden="true"
					className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
				/>
			</Link>
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
			<div className="grid grid-cols-1 gap-x-12 sm:grid-cols-2 lg:grid-cols-3">
				{products.map((product, index) => (
					<Reveal delay={(index % 3) * 0.06} key={product.slug}>
						<ProductCard product={product} />
					</Reveal>
				))}
			</div>
		);
	}

	return (
		<div className="space-y-16">
			{productCategories.map((category) => {
				const categoryProducts = productsByCategory(category);
				return (
					<div key={category}>
						<div className="mb-6 flex items-baseline justify-between gap-4 border-border border-b pb-3">
							<h2 className="font-heading font-medium text-2xl tracking-tight">
								{category}
							</h2>
							<span className="font-mono text-muted-foreground text-xs">
								{categoryProducts.length} products
							</span>
						</div>
						<div className="grid grid-cols-1 gap-x-12 sm:grid-cols-2 lg:grid-cols-3">
							{categoryProducts.map((product, index) => (
								<Reveal delay={(index % 3) * 0.06} key={product.slug}>
									<ProductCard product={product} />
								</Reveal>
							))}
						</div>
					</div>
				);
			})}
		</div>
	);
}
