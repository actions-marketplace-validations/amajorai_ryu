import { standalonePortOffset } from "@ryu/app-host/standalone";
import { isRyuStandaloneApp, STANDALONE_APP_ID } from "@/src/lib/product.ts";

/** Default Core base URL — swappable via `VITE_CORE_URL` at build time. */
const configuredCoreUrl = (
	import.meta.env.VITE_CORE_URL as string | undefined
)?.replace(/\/$/, "");

export function resolveDefaultCoreUrl(
	configuredUrl: string | undefined,
	standaloneAppId: string
): string {
	if (standaloneAppId) {
		return `http://127.0.0.1:${7980 + standalonePortOffset(standaloneAppId)}`;
	}
	return configuredUrl || "http://127.0.0.1:7980";
}

export const DEFAULT_CORE_URL = resolveDefaultCoreUrl(
	configuredCoreUrl,
	isRyuStandaloneApp() ? STANDALONE_APP_ID : ""
);

/**
 * Core used for the device-auth broker (`/api/auth/login` + `/api/auth/status`).
 *
 * Desktop: same as {@link DEFAULT_CORE_URL} (local sidecar).
 * Webapp: set `VITE_AUTH_CORE_URL=https://core.ryuhq.com` so sign-in works
 * without a local node; after login the node store prefers local when reachable.
 */
export const AUTH_CORE_URL =
	(import.meta.env.VITE_AUTH_CORE_URL as string | undefined)?.replace(
		/\/$/,
		""
	) || DEFAULT_CORE_URL;
