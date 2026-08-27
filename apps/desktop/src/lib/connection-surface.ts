import {
	BrowserIcon,
	ComputerTerminal01Icon,
	GlobeIcon,
	LaptopIcon,
	Link01Icon,
	SmartPhone01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { ConnectedClient } from "./api/connections.ts";

export interface ConnectionSurfaceMeta {
	icon: IconSvgElement;
	known: boolean;
	label: string;
}

const humanize = (value: string): string => {
	const words = value.replaceAll("_", " ").replaceAll("-", " ").split(" ");
	const title = words
		.filter(Boolean)
		.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
		.join(" ");
	return title || "Connected client";
};

export const connectionSurfaceMeta = (
	surface: string | null
): ConnectionSurfaceMeta => {
	switch (surface) {
		case "desktop":
			return { icon: LaptopIcon, known: true, label: "Desktop app" };
		case "cli":
			return { icon: ComputerTerminal01Icon, known: true, label: "CLI" };
		case "mobile":
			return { icon: SmartPhone01Icon, known: true, label: "Mobile" };
		case "extension":
			return { icon: BrowserIcon, known: true, label: "Browser extension" };
		case "web":
			return { icon: GlobeIcon, known: true, label: "Web" };
		default:
			return {
				icon: Link01Icon,
				known: false,
				label: surface ? humanize(surface) : "Connected client",
			};
	}
};

export const connectionDisplayName = (client: ConnectedClient): string =>
	client.userName ??
	client.userId ??
	client.clientLabel ??
	(client.surface ? connectionSurfaceMeta(client.surface).label : "Anonymous");
