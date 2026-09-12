// Render the shipped Wire entry against an isolated, real News sidecar.
// This transport adapter does not mock responses or prove Core's ext-proxy.
import type { RyuWireBridge } from "../../../../apps-store/news/ui/src/ryu.d.ts";

const news: RyuWireBridge = {
	async request({ method = "GET", path, body }) {
		if (!path.startsWith("/") || path.startsWith("//")) {
			throw new Error("Invalid News path");
		}
		const response = await fetch(`/api/news${path}`, {
			method,
			headers: { "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const result: unknown = await response.json();
		if (!response.ok) {
			const message =
				result && typeof result === "object" && "error" in result
					? String(result.error)
					: `News request failed (${response.status})`;
			throw new Error(message);
		}
		return result;
	},
};

const tab = new URL(window.location.href).searchParams.get("tab") ?? "sources";
Object.assign(window, { ryu: { context: { tab }, news } });
await import("../../../../apps-store/news/ui/src/main.tsx");
