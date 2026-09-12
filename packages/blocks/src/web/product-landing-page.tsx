import type { Product } from "./data/products.tsx";
import FAQ from "./faq.tsx";
import {
	BentoGrid,
	FeatureSplitRow,
	ProductCta,
	ProductHero,
	SectionHeading,
} from "./sections.tsx";

/** Shared product-page body used by the catalog and the public surface aliases. */
export default function ProductLandingPage({ product }: { product: Product }) {
	const visualFeatures = product.bento.items.filter((item) => item.visual);
	const faqItems = product.faq?.map((item, index) => ({
		id: `${product.slug}-faq-${index}`,
		title: item.q,
		content: item.a,
	}));

	return (
		<div className="pb-8" data-testid={`product-page-${product.slug}`}>
			<ProductHero {...product.hero} />

			{visualFeatures.length ? (
				<section className="container mx-auto px-4 py-16 md:py-24">
					<div className="mx-auto max-w-6xl">
						<SectionHeading
							eyebrow={product.bento.eyebrow}
							title={`What you can do with ${product.name}`}
						/>
						<BentoGrid items={visualFeatures} />
					</div>
				</section>
			) : null}

			{product.splits?.length ? (
				<section className="container mx-auto px-4 py-8 md:py-16">
					<div className="mx-auto max-w-6xl space-y-24">
						{product.splits.map((split) => (
							<FeatureSplitRow feature={split} key={split.title} />
						))}
					</div>
				</section>
			) : null}

			{faqItems?.length ? <FAQ items={faqItems} /> : null}

			<ProductCta {...product.cta} subtitle="" title={`Try ${product.name}`} />
		</div>
	);
}
