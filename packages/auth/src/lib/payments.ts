import { HTTPClient, Polar } from "@polar-sh/sdk";
import {
	WebhookVerificationError as PolarWebhookVerificationError,
	validateEvent as polarValidateEvent,
} from "@polar-sh/sdk/webhooks";
import { env } from "@ryu/env/server";
import { POLAR_API_VERSION } from "./polar-api.ts";

const polarHttpClient = new HTTPClient();
polarHttpClient.addHook("beforeRequest", (request) => {
	request.headers.set("Polar-Version", POLAR_API_VERSION);
});

export const polarClient = new Polar({
	accessToken: env.POLAR_ACCESS_TOKEN,
	httpClient: polarHttpClient,
	server: env.POLAR_SERVER,
});

/**
 * Re-export the Polar SDK's Standard-Webhooks verifier through `@ryu/auth` so
 * webhook handlers in other packages (e.g. `@ryu/api`) can verify Polar events
 * without taking a direct dependency on `@polar-sh/sdk` (which is installed only
 * here). Mirrors how this module wraps the rest of the Polar SDK surface.
 */
export const validatePolarEvent = polarValidateEvent;
export { PolarWebhookVerificationError };

export interface EnsurePolarCustomerInput {
	email: string;
	id: string;
	name?: string | null;
}

/**
 * Idempotently provisions a Polar customer for a user without ever failing the
 * caller. An existing customer must already belong to the user; email alone
 * cannot authorize linking a legacy or organization payer. Any Polar/API error is
 * logged and swallowed so billing problems never block sign-up.
 */
export const ensurePolarCustomer = async ({
	id,
	email,
	name,
}: EnsurePolarCustomerInput): Promise<boolean> => {
	if (!email) {
		return false;
	}

	try {
		const { result } = await polarClient.customers.list({ email });
		if (result.items.length > 0) {
			return result.items.some(
				(customer) =>
					customer.externalId === id &&
					customer.metadata.scope !== "org" &&
					typeof customer.metadata.orgId !== "string"
			);
		}

		await polarClient.customers.create({
			email,
			name: name ?? undefined,
			externalId: id,
		});
		return true;
	} catch (error) {
		console.error(
			"Failed to provision Polar customer (non-critical):",
			error instanceof Error ? error.message : error
		);
		return false;
	}
};

/**
 * Keeps the Polar customer's email/name in sync when the user record changes,
 * mirroring the plugin's previous onUserUpdate behaviour. Looks the customer up
 * by externalId (the user id). Never throws so a profile update cannot fail.
 */
export const syncPolarCustomer = async ({
	id,
	email,
	name,
}: EnsurePolarCustomerInput): Promise<boolean> => {
	if (!email) {
		return false;
	}

	try {
		await polarClient.customers.updateExternal({
			externalId: id,
			customerUpdateExternalID: { email, name: name ?? undefined },
		});
		return true;
	} catch (error) {
		console.error(
			"Failed to sync Polar customer (non-critical):",
			error instanceof Error ? error.message : error
		);
		return false;
	}
};
