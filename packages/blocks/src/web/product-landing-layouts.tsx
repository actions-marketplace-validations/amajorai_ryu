import type { ReactNode } from "react";
import { landingVisualFrameClass } from "./landing-card-tones.ts";
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
			className="mx-auto max-w-6xl px-6 pt-16 pb-12 md:pt-24 md:pb-16"
			data-product-hero-layout="showcase"
		>
			<div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
				<div className="min-w-0 max-w-2xl">
					<h1 className={landingHeadlineClass}>{title}</h1>
					<p className={landingSubheadlineClass}>{subtitle}</p>
					<div className="mt-8 flex flex-wrap items-center gap-3">
						{actions}
					</div>
				</div>
				<div
					className={`${landingVisualFrameClass} flex min-h-72 min-w-0 items-center justify-center md:min-h-[22rem] [&>*]:w-full [&>*]:max-w-3xl`}
					data-product-visual
				>
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
							className={`${landingVisualFrameClass} mb-6 flex min-h-52 items-center justify-center [&>*]:w-full`}
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
