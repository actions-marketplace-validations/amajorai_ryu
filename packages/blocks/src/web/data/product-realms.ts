import type { LucideIcon } from "lucide-react";
import {
	Bell,
	Bot,
	Box,
	Cable,
	Cpu,
	Key,
	Mail,
	Monitor,
	Settings2,
	Share2,
	Shield,
	Zap,
} from "lucide-react";

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
	| "connect"
	| "passport"
	| "box"
	| "mail"
	| "notify"
	| "hire"
	| "compute"
	| "share";

export interface ProductRealm {
	description: string;
	href: string;
	icon: LucideIcon;
	id: ProductRealmId;
	label: string;
	shortLabel: string;
	type: "workspace" | "service";
}

/**
 * Shared navigation groups keep the desktop dropdown and mobile sheet aligned.
 * The platform links remain a separate column in the desktop menu.
 */
export const PRODUCT_NAV_GROUPS = [
	{
		title: "Main Products",
		ids: ["os", "bot", "console"] as const,
	},
	{
		title: "Service APIs",
		ids: ["connect", "passport", "box", "mail", "notify"] as const,
	},
	{
		title: "Capacity & Apps",
		ids: ["compute", "share", "hire"] as const,
	},
] as const;

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
			"The operator surface for servers, models, permissions, and Apps.",
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
			"MCP hosting, Skills, governed tools, and Composio behind one edge.",
		href: "/products/connect",
		icon: Cable,
		id: "connect",
		label: "Ryu Connect",
		shortLabel: "Connect",
		type: "service",
	},
	{
		description:
			"Encrypted identity connections for agents and their allowed sessions.",
		href: "/products/passport",
		icon: Key,
		id: "passport",
		label: "Ryu Passport",
		shortLabel: "Passport",
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
			"API-first email inboxes for agents, with signed inbound mail.",
		href: "/products/mail",
		icon: Mail,
		id: "mail",
		label: "Ryu Mail",
		shortLabel: "Mail",
		type: "service",
	},
	{
		description:
			"Durable events, live activities, and channel delivery over HTTP.",
		href: "/products/notify",
		icon: Bell,
		id: "notify",
		label: "Ryu Notify",
		shortLabel: "Notify",
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
	{
		description: "Rent governed CPU or GPU capacity for a bounded run.",
		href: "/products/compute",
		icon: Cpu,
		id: "compute",
		label: "Ryu Compute",
		shortLabel: "Compute",
		type: "service",
	},
	{
		description: "Share idle Ryu capacity without giving up your machine.",
		href: "/products/share",
		icon: Share2,
		id: "share",
		label: "Ryu Share",
		shortLabel: "Share",
		type: "service",
	},
];

export function productRealmsFor(
	ids: readonly ProductRealmId[]
): ProductRealm[] {
	return ids.flatMap((id) => {
		const realm = PRODUCT_REALMS.find((candidate) => candidate.id === id);
		return realm ? [realm] : [];
	});
}

export function productRealm(id: ProductRealmId): ProductRealm {
	return PRODUCT_REALMS.find((realm) => realm.id === id) ?? PRODUCT_REALMS[0];
}
