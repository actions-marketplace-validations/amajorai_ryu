const SSO_CALLBACK_PATH =
	/^\/sso\/(?:callback|saml2\/callback|saml2\/sp\/acs)\/([^/]+)$/;

/** Return the provider id from a provider-specific Better Auth callback path. */
export function providerIdFromSsoCallbackPath(path: string): string | null {
	const match = SSO_CALLBACK_PATH.exec(path);
	if (!match?.[1]) {
		return null;
	}

	try {
		return decodeURIComponent(match[1]);
	} catch {
		return null;
	}
}
