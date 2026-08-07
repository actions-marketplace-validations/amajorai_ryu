// The island's widget host: the island side of the Ryu Apps widget boundary.
//
// It provides `WidgetHostContext` for the island transcript, so a
// `data-tool-widget-available` part mounts the SAME `AppWidget` the desktop chat
// mounts. Without this provider `useWidgetHost()` returns null and a widget
// degrades to a plain tool row — which is what the island did before.
//
// What differs from the desktop is only the plumbing, not the renderer:
//
//   - the three governed round-trips go over `window.island.plugins.coreHttp`
//     (main holds the node token; the renderer is cross-origin to Core), not a
//     renderer-side fetch. Same paths, same bodies, same Gateway chain.
//   - `openExternal` is Electron's shell, not Tauri's.
//   - `proxyOrigin` comes from the island's own settings blob.
//
// The frame still never holds the Core token and never reaches the network; every
// privileged action is a capability-gated RPC the host performs.

import { CodedRpcError } from "@ryu/app-host/rpc";
import { AppWidget } from "@ryu/blocks/desktop/agent-elements/app-widget";
import {
	type WidgetCallToolResult,
	WidgetHostContext,
	type WidgetHostServices,
	type WidgetHostValue,
} from "@ryu/blocks/desktop/agent-elements/widget-host-context";
import { type ReactNode, useEffect, useMemo, useState } from "react";

/**
 * POST a governed widget route through main. `pluginCoreHttp` re-validates the
 * path shape and method before attaching the node token, and its failure codes
 * are the same closed enum the widget RPC gate speaks, so a failure maps straight
 * onto {@link CodedRpcError} with no status guessing.
 */
async function postWidget<T>(path: string, body: unknown): Promise<T> {
	const result = await window.island.plugins.coreHttp({
		body,
		method: "POST",
		path,
	});
	if (!result.ok) {
		throw new CodedRpcError(result.code, result.message);
	}
	return result.data as T;
}

const services: WidgetHostServices = {
	callTool: (input) =>
		postWidget<WidgetCallToolResult>("/api/widgets/tools/call", {
			arguments: input.args,
			instance_id: input.instanceId,
			server_id: input.serverId,
			tool_call_id: input.toolCallId,
			tool_id: input.name,
		}),
	sendFollowUpMessage: async (input) => {
		await postWidget<unknown>("/api/widgets/follow-up", {
			instance_id: input.instanceId,
			prompt: input.prompt,
			tool_call_id: input.toolCallId,
		});
	},
	setWidgetState: async (input) => {
		await postWidget<unknown>("/api/widgets/state", {
			instance_id: input.instanceId,
			state: input.state,
			tool_call_id: input.toolCallId,
		});
	},
};

/**
 * Wrap the island transcript so widget parts mount. Reads the Core origin from
 * the island's settings (the asset proxy's base); until it resolves, the origin
 * is empty and a widget mounting in that window simply proxies nothing — it is
 * captured once per widget mount, and settings land long before a turn streams.
 */
export function IslandWidgetHost({ children }: { children: ReactNode }) {
	const [proxyOrigin, setProxyOrigin] = useState("");

	useEffect(() => {
		let cancelled = false;
		window.island.settings
			.get()
			.then((settings) => {
				if (!cancelled) {
					setProxyOrigin(settings.coreBaseUrl);
				}
			})
			.catch(() => {
				// No settings: widgets render with no asset proxy rather than not at all.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const value = useMemo<WidgetHostValue>(
		() => ({
			env: {
				openExternal: (href: string) => window.island.system.openExternal(href),
				proxyOrigin,
			},
			Renderer: AppWidget,
			services,
		}),
		[proxyOrigin]
	);

	return (
		<WidgetHostContext.Provider value={value}>
			{children}
		</WidgetHostContext.Provider>
	);
}
