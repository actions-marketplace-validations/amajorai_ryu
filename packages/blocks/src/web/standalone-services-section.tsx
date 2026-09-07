import { ArrowUpRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { products } from "./data/products.tsx";
import { SectionTitle, sectionSubtitleClass } from "./sections.tsx";

const SERVICE_DESCRIPTIONS: Record<string, string> = {
	gateway:
		"Route model and tool requests with shared access rules and budgets.",
	box: "Give agents a persistent workspace for files and code.",
	notify: "Send notifications through one API.",
	mail: "Give agents an inbox to send and receive email.",
	hire: "Call a specialist agent for a specific task.",
};

export function StandaloneServicesSection() {
	return (
		<section
			aria-label="Standalone services"
			className="mx-auto max-w-6xl px-6 py-16 md:py-24"
			data-testid="standalone-services"
			id="standalone-services"
		>
			<div className="grid gap-10 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:gap-16">
				<div>
					<SectionTitle title="Add Ryu to your product" />
					<p className={sectionSubtitleClass}>
						Use an individual service through its API. Keep your app and add the
						capabilities you need.
					</p>
				</div>
				<div className="space-y-6">
					{products
						.filter((product) => product.standalone)
						.map((product) => (
							<Link
								className="group flex items-start justify-between gap-6 py-2 outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
								data-testid={`standalone-service-${product.slug}`}
								href={`/products/${product.slug}` as Route}
								key={product.slug}
							>
								<div>
									<h3 className="font-medium group-hover:underline group-hover:underline-offset-4">
										{product.name}
									</h3>
									<p className="mt-2 max-w-md text-muted-foreground text-sm leading-relaxed">
										{SERVICE_DESCRIPTIONS[product.slug] ?? product.tagline}
									</p>
								</div>
								<ArrowUpRight
									aria-hidden="true"
									className="mt-1 size-4 shrink-0 text-muted-foreground"
								/>
							</Link>
						))}
				</div>
			</div>
		</section>
	);
}
