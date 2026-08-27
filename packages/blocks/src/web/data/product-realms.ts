import type { LucideIcon } from "lucide-react";
import { Bot, Box, Monitor, Settings2, Shield, Zap } from "lucide-react";

/**
 * The small, public product vocabulary shared by the landing page and the
 * marketing header. The larger product catalogue remains in `products.tsx`;
 * this list is intentionally limited to the products people can choose.
 */
export type ProductRealmId =
	| "os"
	| "bot"
	| "console"
	| "gateway"
	| "box"
	| "hire";

export interface ProductRealm {
	description: string;
	href: string;
	icon: LucideIcon;
	id: ProductRealmId;
	label: string;
	shortLabel: string;
	type: "workspace" | "service";
}

export const PRODUCT_REALMS: readonly ProductRealm[] = [
	{
		description: "A calm desktop workspace where your tools become windows.",
		href: "/products/os",
		icon: Monitor,
		id: "os",
		label: "Ryu OS",
		shortLabel: "OS",
		type: "workspace",
	},
	{
		description: "Managed AI you can ask for work without setting up a stack.",
		href: "/bot",
		icon: Bot,
		id: "bot",
		label: "Ryu Bot",
		shortLabel: "Bot",
		type: "workspace",
	},
	{
		description:
			"The operator surface for nodes, models, permissions, and Apps.",
		href: "/console",
		icon: Settings2,
		id: "console",
		label: "Ryu Console",
		shortLabel: "Console",
		type: "workspace",
	},
	{
		description:
			"Programmatic, governed calls to tools and Skills from any system.",
		href: "/products/gateway",
		icon: Shield,
		id: "gateway",
		label: "Ryu Gateway",
		shortLabel: "Gateway",
		type: "service",
	},
	{
		description:
			"A persistent, isolated workspace for agent runs and previews.",
		href: "/products/box",
		icon: Box,
		id: "box",
		label: "Ryu Box",
		shortLabel: "Box",
		type: "service",
	},
	{
		description:
			"Recruit a specialist for one run and pay from your credit balance.",
		href: "/products/hire",
		icon: Zap,
		id: "hire",
		label: "Ryu Hire",
		shortLabel: "Hire",
		type: "service",
	},
];

export function productRealm(id: ProductRealmId): ProductRealm {
	return PRODUCT_REALMS.find((realm) => realm.id === id) ?? PRODUCT_REALMS[0];
}
