/**
 * Polar API contract selection is independent from the installed SDK package
 * version. Keep the pin in a dependency-free module so SDK and direct HTTP
 * callers use the same contract.
 */
export const POLAR_API_VERSION = "2026-04" as const;

/**
 * Add the pinned Polar API version to an existing header set.
 *
 * The version is applied last so a caller cannot accidentally opt a request
 * into Polar's moving Current or unstable Next contract.
 */
export const withPolarApiVersion = (headers?: HeadersInit): Headers => {
	const versionedHeaders = new Headers(headers);
	versionedHeaders.set("Polar-Version", POLAR_API_VERSION);
	return versionedHeaders;
};

/**
 * Build the common init used by the repository's direct Polar API calls.
 * Authentication and the API version are set at this boundary rather than
 * repeated at each provisioning operation.
 */
export const polarRequestInit = (
	token: string,
	init?: RequestInit
): RequestInit => {
	const headers = withPolarApiVersion(init?.headers);
	headers.set("Authorization", `Bearer ${token}`);
	headers.set("Content-Type", "application/json");
	return { ...init, headers };
};
