"use client";

import { ProductSurfaceCards } from "./product-surface-cards.tsx";
import { SectionTitle, sectionSubtitleClass } from "./sections.tsx";
import { StaggerLines } from "./stagger-lines.tsx";

export function ProductRealmSelector() {
	return (
		<section aria-label="Ryu surfaces" data-testid="product-realm-selector">
			<StaggerLines className="max-w-2xl">
				<SectionTitle title="Choose how your team uses Ryu" />
				<p className={sectionSubtitleClass}>
					Use apps for daily work, chat with an agent, or manage your
					deployment.
				</p>
			</StaggerLines>
			<ProductSurfaceCards className="mt-12" />
		</section>
	);
}
