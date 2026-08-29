/** Wire contracts shared by the OAuth settings API and its clients. */
export type OAuthApplicationType = "native" | "web";
export type OAuthClientType = "confidential" | "public";

export interface OAuthApp {
	clientId: string;
	clientName: string;
	grantedAt: string;
	icon: string | null;
	kind: "oauth" | "ryu";
	scopes: string;
}

export interface OwnedOAuthApp {
	applicationType: OAuthApplicationType;
	clientId: string;
	clientName: string;
	clientSecret?: string | null;
	clientType: OAuthClientType;
	createdAt: string | null;
	disabled: boolean;
	redirectUris: string[];
	scopes: string[];
}

export interface CreateOAuthAppInput {
	applicationType: OAuthApplicationType;
	clientName: string;
	clientType: OAuthClientType;
	redirectUris: string[];
	scopes: string[];
}
