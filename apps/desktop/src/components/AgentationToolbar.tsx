import { lazy, Suspense } from "react";
import { useDeveloperMode } from "@/src/hooks/useDeveloperMode.ts";
import { useMcpBridgeArming } from "@/src/lib/mcp-bridge.ts";

// Lazy, client-only import so the toolbar's chunk is never bundled into the
// shipped app — the dev guard below returns before it ever mounts, so Vite
// never fetches the dynamic chunk in a production build.
const Agentation = lazy(() =>
	import("agentation").then((m) => ({ default: m.Agentation }))
);

// Visual feedback toolbar for developers. Click an element in the app, add a
// note, and the annotation syncs to the local Agentation MCP server (port 4747)
// so the coding agent can read and act on it. Visible in development builds and
// when Developer Mode is enabled in Settings → Developer.
export function AgentationToolbar() {
	const [devMode] = useDeveloperMode();
	// Mounted app-wide and already the one place that reads Developer Mode at
	// boot, so it also carries the MCP bridge's once-per-launch arming reconcile.
	// That reconcile cannot live on the Developer settings tab: startup CONSUMES
	// the arming flag, so something has to re-write it every launch, and a user
	// who never reopens that tab would never disarm a bridge armed by other means.
	// Deliberately above the dev guard below — the "off" write is exactly the one
	// that must still happen when Developer Mode is off.
	useMcpBridgeArming(devMode);
	if (!(import.meta.env.DEV || devMode)) {
		return null;
	}
	return (
		<Suspense fallback={null}>
			<Agentation endpoint="http://localhost:4747" />
		</Suspense>
	);
}
