import { describe, expect, it } from "bun:test";
import {
	openSsoProviderRecord,
	sealSsoProviderRecord,
} from "./sso-provider-encryption.ts";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

describe("SSO provider field encryption", () => {
	it("seals OIDC, SAML, and domain-verification secrets at rest", () => {
		const originalKey = process.env.RYU_DB_MASTER_KEY;
		const originalOverride = process.env.RYU_DB_ALLOW_PLAINTEXT_SECRETS;
		process.env.RYU_DB_MASTER_KEY = TEST_KEY;
		delete process.env.RYU_DB_ALLOW_PLAINTEXT_SECRETS;

		try {
			const sealed = sealSsoProviderRecord({
				domainVerificationToken: "dns-secret",
				oidcConfig: JSON.stringify({
					clientId: "client-id",
					clientSecret: "oidc-secret",
				}),
				samlConfig: {
					cert: "saml-cert",
					entryPoint: "https://idp.example/sso",
					idpMetadata: {
						cert: "idp-cert",
						metadata: "saml-metadata",
						privateKey: "idp-key",
						privateKeyPass: "idp-key-pass",
					},
					privateKey: "saml-key",
					spMetadata: {
						privateKey: "sp-key",
						privateKeyPass: "sp-key-pass",
					},
				},
			});
			const sealedRecord = sealed as Record<string, unknown>;
			const sealedOidc = JSON.parse(
				sealedRecord.oidcConfig as string
			) as Record<string, unknown>;
			const sealedSaml = sealedRecord.samlConfig as Record<string, unknown>;

			expect(sealedRecord.domainVerificationToken).not.toBe("dns-secret");
			expect(sealedOidc.clientSecret).not.toBe("oidc-secret");
			expect(sealedSaml.cert).not.toBe("saml-cert");
			expect(
				(sealedSaml.idpMetadata as Record<string, unknown>).metadata
			).not.toBe("saml-metadata");
			expect(
				(sealedSaml.idpMetadata as Record<string, unknown>).privateKey
			).not.toBe("idp-key");
			expect(sealedSaml.privateKey).not.toBe("saml-key");
			expect(
				(sealedSaml.spMetadata as Record<string, unknown>).privateKey
			).not.toBe("sp-key");

			const opened = openSsoProviderRecord(sealed) as Record<string, unknown>;
			expect({
				...opened,
				oidcConfig: JSON.parse(opened.oidcConfig as string),
			}).toEqual({
				domainVerificationToken: "dns-secret",
				oidcConfig: {
					clientId: "client-id",
					clientSecret: "oidc-secret",
				},
				samlConfig: {
					cert: "saml-cert",
					entryPoint: "https://idp.example/sso",
					idpMetadata: {
						cert: "idp-cert",
						metadata: "saml-metadata",
						privateKey: "idp-key",
						privateKeyPass: "idp-key-pass",
					},
					privateKey: "saml-key",
					spMetadata: {
						privateKey: "sp-key",
						privateKeyPass: "sp-key-pass",
					},
				},
			});
		} finally {
			if (originalKey === undefined) {
				delete process.env.RYU_DB_MASTER_KEY;
			} else {
				process.env.RYU_DB_MASTER_KEY = originalKey;
			}
			if (originalOverride === undefined) {
				delete process.env.RYU_DB_ALLOW_PLAINTEXT_SECRETS;
			} else {
				process.env.RYU_DB_ALLOW_PLAINTEXT_SECRETS = originalOverride;
			}
		}
	});
});
