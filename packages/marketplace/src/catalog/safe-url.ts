// packages/marketplace/src/catalog/safe-url.ts
//
// The render-layer href guard, shared by every catalog detail surface.
//
// Catalog sources are untrusted — a community listing's `homepage`, a release's
// `url`, a manifest's `privacyPolicyUrl` are all publisher-controlled strings.
// Core allowlists schemes on the way out, and this is the second half of that
// defence: nothing reaches an `<a href>` without parsing as http(s) here, so a
// `javascript:` or `data:` URL cannot execute even if a backend sanitizer is ever
// bypassed or a new source forgets to call one.

/** Return `u` only when it parses as an http(s) URL, else null. */
export function safeHttpUrl(u?: string | null): string | null {
	if (!u) {
		return null;
	}
	try {
		const parsed = new URL(u);
		if (parsed.protocol === "http:" || parsed.protocol === "https:") {
			return parsed.toString();
		}
		return null;
	} catch {
		return null;
	}
}
