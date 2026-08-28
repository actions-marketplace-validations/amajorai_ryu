"use client";

import { ProductSurfaceCards } from "./product-surface-cards.tsx";
import { SectionTitle, sectionSubtitleClass } from "./sections.tsx";
import { StaggerLines } from "./stagger-lines.tsx";

export function ProductRealmSelector() {
	return (
		<section aria-label="Ryu surfaces" data-testid="product-realm-selector">
			<StaggerLines className="max-w-2xl">
				<SectionTitle title="A simple toolkit that connects the tools they already use." />
				<p className={sectionSubtitleClass}>
					Use the same deployment through Apps, Bot, and Console.
				</p>
			</StaggerLines>
			<ProductSurfaceCards className="mt-12" />
		</section>
	);
}
