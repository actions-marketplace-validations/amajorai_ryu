/** The existing desktop route used by the onboarding Extensions hand-off. */
export const EXTENSIONS_ROUTE = "/extensions";

/**
 * Keep the hand-off target explicit and testable. The route resolves to the
 * Store's installed-only Plugins view, so onboarding never invents a second
 * extension catalog or a provider-specific install API.
 */
export function onboardingExtensionsRoute(): string {
	return EXTENSIONS_ROUTE;
}
