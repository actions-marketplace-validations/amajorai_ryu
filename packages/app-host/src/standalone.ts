/** Shared contract for a Desktop host built around one Ryu app. */

export interface StandaloneAppBundle {
	appId: string;
	appName: string;
	manifest: Record<string, unknown>;
	schemaVersion: 1;
	sidecars: readonly StandaloneSidecarResource[];
	uiCode: string | null;
	version: string;
}

export interface StandaloneSidecarResource {
	command: string | null;
	commandEnv?: string;
	mode: "core-provisioned" | "embedded";
	name: string;
	resourcePath?: string;
	sha256?: string;
}

export type StandaloneBootstrapPhase =
	| "loading"
	| "installing"
	| "enabling"
	| "ready"
	| "no_companion"
	| "error";

const STANDALONE_PORT_OFFSET_MIN = 12_000;
const STANDALONE_PORT_OFFSET_SPAN = 16_000;

/**
 * Derive one stable port namespace for an app-specific Desktop build.
 *
 * The offset stays outside the normal release/dev/canary/beta bands while the
 * app id keeps different standalone products from fighting over Core and their
 * manifest sidecars. The native host still remains single-instance per product.
 */
export function standalonePortOffset(appId: string): number {
	let hash = 2_166_136_261;
	for (const byte of new TextEncoder().encode(appId)) {
		hash ^= byte;
		hash = Math.imul(hash, 16_777_619) >>> 0;
	}
	return STANDALONE_PORT_OFFSET_MIN + (hash % STANDALONE_PORT_OFFSET_SPAN);
}

/**
 * Resolve an app-private data root below the Ryu host data directory. The native
 * host uses `<platform data dir>/Ryu/ryu-apps/<slug>`; callers pass that
 * `<platform data dir>/Ryu` root here so browser-side diagnostics and native
 * launch agree on the same namespace.
 *
 * This is a string-only helper so the same namespace rule can be used by the
 * browser-facing builder and by native launch diagnostics without importing a
 * platform filesystem library into the Companion package.
 */
export function standaloneDataDir(
	appId: string,
	platformDataDir: string
): string {
	const slug =
		appId
			.trim()
			.replace(/[^a-zA-Z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "app";
	const root = platformDataDir.replace(/[\\/]+$/, "");
	return `${root}/ryu-apps/${slug}`;
}

/** Find the first Companion contributed by the selected app. */
export function standaloneCompanionId(
	companions: readonly { id: string; pluginId: string }[],
	appId: string
): string | null {
	return (
		companions.find((companion) => companion.pluginId === appId)?.id ?? null
	);
}

/** Validate the native carriage before it crosses the Tauri bridge. */
export function parseStandaloneAppBundle(
	value: unknown
): StandaloneAppBundle | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const schemaVersion = record.schemaVersion;
	const appId = typeof record.appId === "string" ? record.appId.trim() : "";
	const appName =
		typeof record.appName === "string" ? record.appName.trim() : "";
	const version =
		typeof record.version === "string" ? record.version.trim() : "";
	const manifest = record.manifest;
	const sidecars = record.sidecars;
	const uiCode = record.uiCode;
	if (
		schemaVersion !== 1 ||
		!(appId && appName) ||
		!version ||
		typeof manifest !== "object" ||
		manifest === null ||
		Array.isArray(manifest) ||
		!Array.isArray(sidecars) ||
		!sidecars.every((sidecar) => {
			if (typeof sidecar !== "object" || sidecar === null) {
				return false;
			}
			const candidate = sidecar as Record<string, unknown>;
			return (
				typeof candidate.name === "string" &&
				(candidate.mode === "core-provisioned" ||
					candidate.mode === "embedded") &&
				(candidate.command === null || typeof candidate.command === "string") &&
				(candidate.commandEnv === undefined ||
					typeof candidate.commandEnv === "string") &&
				(candidate.resourcePath === undefined ||
					typeof candidate.resourcePath === "string") &&
				(candidate.sha256 === undefined || typeof candidate.sha256 === "string")
			);
		}) ||
		(uiCode !== null && typeof uiCode !== "string")
	) {
		return null;
	}
	return {
		schemaVersion: 1,
		appId,
		appName,
		version,
		manifest: manifest as Record<string, unknown>,
		sidecars: sidecars as StandaloneSidecarResource[],
		uiCode: uiCode as string | null,
	};
}

export const standalonePortOffsetBounds = {
	max: STANDALONE_PORT_OFFSET_MIN + STANDALONE_PORT_OFFSET_SPAN - 1,
	min: STANDALONE_PORT_OFFSET_MIN,
} as const;
