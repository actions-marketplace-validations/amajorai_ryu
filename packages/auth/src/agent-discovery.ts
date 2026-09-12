/** Registration discovery for Ryu's existing OAuth client and consent flow. */
export function agentRegistrationMetadata(
	metadata: Record<string, unknown>,
	siteOrigin: string
) {
	if (
		typeof metadata.registration_endpoint !== "string" ||
		typeof metadata.authorization_endpoint !== "string"
	) {
		return undefined;
	}
	return {
		skill: new URL("/auth.md", siteOrigin).href,
		register_uri: metadata.registration_endpoint,
		identity_types_supported: ["anonymous"],
		anonymous: {
			credential_types_supported: [
				"oauth2_access_token",
				"oauth2_refresh_token",
			],
		},
		claim_uri: metadata.authorization_endpoint,
		claim_flows_supported: ["authorization_code"],
		...(typeof metadata.revocation_endpoint === "string"
			? { revocation_uri: metadata.revocation_endpoint }
			: {}),
	};
}
