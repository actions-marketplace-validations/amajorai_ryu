import type { ReactNode } from "react";
import {
	landingHeadlineClass,
	landingSubheadlineClass,
} from "./landing-typography.ts";
import type { BentoItem } from "./sections.tsx";

export function ProductHeroFrame({
	actions,
	subtitle,
	title,
	visual,
}: {
	actions: ReactNode;
	subtitle: string;
	title: string;
	visual: ReactNode;
}) {
	return (
		<section
			className="mx-auto max-w-6xl px-6 pt-16 pb-16 md:pt-24 md:pb-20"
			data-product-hero-layout="split"
		>
			<div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
				<div className="min-w-0 max-w-xl">
					<h1 className={landingHeadlineClass}>{title}</h1>
					<p className={landingSubheadlineClass}>{subtitle}</p>
					<div className="mt-8 flex flex-wrap items-center gap-3">
						{actions}
					</div>
				</div>
				<div className="min-w-0 bg-muted/40 p-6 md:p-8" data-product-visual>
					{visual}
				</div>
			</div>
		</section>
	);
}

export function ProductBentoFrame({ items }: { items: BentoItem[] }) {
	return (
		<div
			className="grid gap-x-12 gap-y-12 md:grid-cols-2"
			data-product-bento-layout="grid"
		>
			{items.map((item) => (
				<article className="flex min-w-0 flex-col" key={item.title}>
					{item.visual ? (
						<div
							className="mb-6 flex min-h-52 items-center justify-center bg-muted/40 p-6 [&>*]:w-full"
							data-product-visual
						>
							{item.visual}
						</div>
					) : null}
					<h3 className="font-heading font-medium text-xl tracking-tight">
						{item.title}
					</h3>
					<p className="mt-2 max-w-lg text-muted-foreground text-sm leading-relaxed">
						{item.description}
					</p>
					{item.action ? <div className="mt-4">{item.action}</div> : null}
				</article>
			))}
		</div>
	);
}
