import { dockTabKind } from "@/src/components/panels/dock-panels.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import { request } from "@/src/lib/api/client.ts";
import type { PluginDockPanel } from "@/src/lib/api/plugins.ts";

export const CONTRIBUTED_LINK_OPENED_EVENT = "ryu:contributed-link-opened";

export interface ContributedLinkOpenResult {
	kind: string;
	label: string;
}

function handlerFor(panels: PluginDockPanel[], url: URL) {
	return panels.find((panel) => {
		const handler = panel.spec?.linkHandler;
		return handler?.schemes.includes(url.protocol.slice(0, -1));
	});
}

/**
 * Open a URL through the first enabled app panel that declares a matching link
 * handler. The endpoint must live under that app's own generic ext-proxy mount.
 */
export async function openContributedLink(
	target: ApiTarget,
	panels: PluginDockPanel[],
	href: string
): Promise<ContributedLinkOpenResult | null> {
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return null;
	}
	const panel = handlerFor(panels, url);
	const handler = panel?.spec?.linkHandler;
	if (!(panel && handler)) {
		return null;
	}
	const ownedPrefix = `/api/ext/${panel.plugin}/`;
	if (!handler.path.startsWith(ownedPrefix)) {
		return null;
	}
	await request<unknown>(target, handler.path, {
		method: handler.method ?? "POST",
		body: { [handler.bodyKey ?? "url"]: url.toString() },
	});
	window.dispatchEvent(
		new CustomEvent(CONTRIBUTED_LINK_OPENED_EVENT, {
			detail: { plugin: panel.plugin, url: url.toString() },
		})
	);
	return { kind: dockTabKind(panel), label: panel.title };
}
