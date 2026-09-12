import { OrganizationSeatEntitlement } from "@ryu/db/models/organization-seat-entitlement.model";
import { PolarBillingProjection } from "@ryu/db/models/polar-billing-projection.model";
import { polarClient } from "./payments.ts";
import { polarOrganizationExternalId } from "./polar-credits.ts";

/** Payer email is contact information, never an organization ownership proof. */
export async function resolveOrganizationPolarCustomerId(
	organizationId: string
): Promise<string | null> {
	const externalId = polarOrganizationExternalId(organizationId);
	try {
		const customer = await polarClient.customers.getExternal({ externalId });
		if (customer.externalId !== externalId) {
			throw new Error(
				"Polar returned a customer for a different billing identity"
			);
		}
		return customer.id;
	} catch (error) {
		const status =
			typeof error === "object" && error !== null
				? ((error as { statusCode?: unknown }).statusCode ??
					(error as { status?: unknown }).status)
				: undefined;
		if (status !== 404) {
			throw error;
		}
	}
	// A known legacy contract needs explicit provider reconciliation. Returning
	// an empty account here would offer a duplicate checkout. A stored id alone
	// does not prove ownership: old email fallback may have populated it.
	const [contract, projection] = await Promise.all([
		OrganizationSeatEntitlement.findOne({ organizationId })
			.select("polarCustomerId")
			.lean<{ polarCustomerId?: string | null }>(),
		PolarBillingProjection.findOne({ organizationId })
			.select("polarCustomerId")
			.lean<{ polarCustomerId?: string | null }>(),
	]);
	if (contract?.polarCustomerId || projection?.polarCustomerId) {
		throw new Error(
			"Organization billing needs customer identity reconciliation before it can be managed or purchased again"
		);
	}
	return null;
}

/** Personal billing follows the authenticated user identity, never payer email. */
export async function resolvePersonalPolarCustomerId(
	userId: string
): Promise<string | null> {
	if (!userId.trim()) {
		throw new Error("A user id is required for personal billing");
	}
	try {
		const customer = await polarClient.customers.getExternal({
			externalId: userId,
		});
		if (
			customer.externalId !== userId ||
			customer.metadata.scope === "org" ||
			typeof customer.metadata.orgId === "string"
		) {
			throw new Error(
				"Polar returned a customer for a different billing identity"
			);
		}
		return customer.id;
	} catch (error) {
		const status =
			typeof error === "object" && error !== null
				? ((error as { statusCode?: unknown }).statusCode ??
					(error as { status?: unknown }).status)
				: undefined;
		if (status !== 404) {
			throw error;
		}
	}
	return null;
}
