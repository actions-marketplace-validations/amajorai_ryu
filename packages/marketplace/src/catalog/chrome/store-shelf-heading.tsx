// packages/marketplace/src/catalog/chrome/store-shelf-heading.tsx
//
// The ONE shelf heading every Store list renders above a card row ("Featured",
// "Text and Embedding", "Team rituals", "From the community", …).
//
// It exists because the same shelf was styled four different ways across the
// Store: Home and Apps/Plugins used `font-semibold text-base tracking-tight`,
// Engines/Agents/Workflows/contributed tabs used a muted uppercase micro-label,
// and Installed used the same micro-label with a different tracking. Switching
// tabs changed the typography of the section titles, which made one surface read
// as several. The heading is a shared primitive so a new tab cannot invent a
// fifth treatment — the App Store shelf title (semibold, base, tight) wins,
// because it is what Home (the front door) and the two biggest catalogs use.
//
// `action` is the trailing affordance on the same baseline (Home's "See all");
// `description` is the optional second line (the community shelf's provenance
// note). Both are slots rather than props of a specific shape so no caller needs
// to fork the component.

import { cn } from "@ryu/ui/lib/utils.ts";
import type { ReactNode } from "react";

export default function StoreShelfHeading({
	children,
	description,
	action,
	onOpen,
	className,
}: {
	/** Trailing affordance rendered on the title's baseline (e.g. "See all"). */
	action?: ReactNode;
	children: ReactNode;
	className?: string;
	/** Optional second line under the title. */
	description?: ReactNode;
	/** Makes the title (and any `action`) one clickable target — used by shelves
	 *  that jump to the full realm. The button lives INSIDE the heading so the
	 *  shelf keeps its heading semantics either way. */
	onOpen?: () => void;
}) {
	const title = (
		<span className="min-w-0 truncate font-semibold text-base tracking-tight">
			{children}
		</span>
	);
	return (
		<div className={cn("mb-2 px-1", className)}>
			<h3 className="flex items-baseline gap-2">
				{onOpen ? (
					<button
						className="group flex min-w-0 items-baseline gap-2 text-left"
						onClick={onOpen}
						type="button"
					>
						{title}
						{action}
					</button>
				) : (
					<>
						{title}
						{action}
					</>
				)}
			</h3>
			{description ? (
				<p className="text-muted-foreground text-xs">{description}</p>
			) : null}
		</div>
	);
}
