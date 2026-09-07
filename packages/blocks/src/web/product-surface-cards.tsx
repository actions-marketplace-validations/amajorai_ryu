import { cn } from "@ryu/ui/lib/utils";
import { ArrowUpRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

const SURFACES = [
	{
		id: "apps",
		label: "Ryu Apps",
		href: "/marketplace",
		description:
			"Applications for research, documents, and other business workflows.",
	},
	{
		id: "bot",
		label: "Ryu Bot",
		href: "/bot",
		description: "Ask an agent to handle a task through chat.",
	},
	{
		id: "console",
		label: "Ryu Console",
		href: "/console",
		description: "Manage agents, connected tools, permissions, and usage.",
	},
] as const;

export function ProductSurfaceCards({ className }: { className?: string }) {
	return (
		<div className={cn("grid gap-10 md:grid-cols-3", className)}>
			{SURFACES.map((surface) => (
				<Link
					className="group block py-2 outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
					data-testid={`realm-card-${surface.id}`}
					href={surface.href as Route}
					key={surface.id}
				>
					<div className="flex items-center justify-between gap-4">
						<h3 className="font-heading font-medium text-xl tracking-tight group-hover:underline group-hover:underline-offset-4">
							{surface.label}
						</h3>
						<ArrowUpRight
							aria-hidden="true"
							className="size-4 text-muted-foreground"
						/>
					</div>
					<p className="mt-3 max-w-xs text-muted-foreground text-sm leading-relaxed">
						{surface.description}
					</p>
				</Link>
			))}
		</div>
	);
}
