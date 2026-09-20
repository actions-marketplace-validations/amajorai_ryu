/**
 * Keep a local development desktop on the local verification page. The
 * device-code endpoint is shared with hosted deployments and may return its
 * canonical public origin when the server was booted with production-facing
 * defaults. Following that value from `bun dev` silently leaves the local
 * stack and can send the user to a real hosted login page.
 *
 * Release builds keep the provider-supplied URL. Dev builds only override a
 * public-looking URL when the configured desktop frontend is loopback, which
 * preserves explicit staging/remote development origins.
 */
export function localizeDevVerificationUrl(
	rawUrl: string,
	frontendUrl: string,
	isDevelopment: boolean
): string {
	if (!isDevelopment) {
		return rawUrl;
	}

	let configured: URL;
	let supplied: URL;
	try {
		configured = new URL(frontendUrl);
		supplied = new URL(rawUrl, configured);
	} catch {
		return rawUrl;
	}

	const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
	if (
		!loopbackHosts.has(configured.hostname) ||
		supplied.origin === configured.origin
	) {
		return rawUrl;
	}

	configured.pathname = supplied.pathname;
	configured.search = supplied.search;
	configured.hash = supplied.hash;
	return configured.toString();
}
