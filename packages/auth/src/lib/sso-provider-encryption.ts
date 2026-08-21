import { open, seal } from "@ryu/db/crypto";
import { mongodbAdapter } from "better-auth/adapters/mongodb";

type BetterAuthAdapterFactory = ReturnType<typeof mongodbAdapter>;
type BetterAuthAdapter = ReturnType<BetterAuthAdapterFactory>;

const SENSITIVE_OIDC_FIELDS = ["clientSecret"] as const;
const SENSITIVE_SAML_FIELDS = [
	"cert",
	"decryptionPvk",
	"idpMetadata",
	"privateKey",
	"spMetadata",
] as const;

const NESTED_SAML_SECRET_FIELDS = [
	"metadata",
	"cert",
	"privateKey",
	"privateKeyPass",
	"encPrivateKey",
	"encPrivateKeyPass",
] as const;

function recordValue(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

function transformSensitiveField(
	field: string,
	value: unknown,
	transform: (value: string) => string
): unknown {
	if (typeof value === "string") {
		return transform(value);
	}
	if (field !== "idpMetadata" && field !== "spMetadata") {
		return value;
	}
	const record = recordValue(value);
	if (!record) {
		return value;
	}
	const output = { ...record };
	for (const key of NESTED_SAML_SECRET_FIELDS) {
		if (typeof output[key] === "string") {
			output[key] = transform(output[key] as string);
		}
	}
	return output;
}

function transformJsonField(
	value: unknown,
	fields: readonly string[],
	transform: (value: string) => string
): unknown {
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value) as unknown;
			const transformed = transformJsonField(parsed, fields, transform);
			return JSON.stringify(transformed);
		} catch {
			return value;
		}
	}
	const record = recordValue(value);
	if (!record) {
		return value;
	}
	const output = { ...record };
	for (const field of fields) {
		const fieldValue = output[field];
		output[field] = transformSensitiveField(field, fieldValue, transform);
	}
	return output;
}

function transformSsoProviderRecord(
	value: unknown,
	transform: (value: string) => string
): unknown {
	const record = recordValue(value);
	if (!record) {
		return value;
	}
	const output = { ...record };
	output.oidcConfig = transformJsonField(
		output.oidcConfig,
		SENSITIVE_OIDC_FIELDS,
		transform
	);
	output.samlConfig = transformJsonField(
		output.samlConfig,
		SENSITIVE_SAML_FIELDS,
		transform
	);
	if (typeof output.domainVerificationToken === "string") {
		output.domainVerificationToken = transform(output.domainVerificationToken);
	}
	return output;
}

function transformSsoPayload(
	model: string,
	value: unknown,
	transform: (value: string) => string
): unknown {
	return model === "ssoProvider"
		? transformSsoProviderRecord(value, transform)
		: value;
}

export function sealSsoProviderRecord(value: unknown): unknown {
	return transformSsoProviderRecord(value, seal);
}

export function openSsoProviderRecord(value: unknown): unknown {
	return transformSsoProviderRecord(value, open);
}

/**
 * Add field encryption at the Better Auth adapter boundary. The adapter factory
 * has already serialized JSON fields when this wrapper sees writes and has
 * parsed them again when it sees reads, so secrets remain queryable only by
 * their non-sensitive provider metadata.
 */
export function wrapSsoProviderAdapter(
	adapter: BetterAuthAdapter
): BetterAuthAdapter {
	const wrapped = { ...adapter };

	const originalCreate = adapter.create;
	wrapped.create = (async (input) => {
		const result = await originalCreate({
			...input,
			data: transformSsoPayload(
				input.model,
				input.data,
				seal
			) as typeof input.data,
		});
		return transformSsoPayload(input.model, result, open);
	}) as BetterAuthAdapter["create"];

	const originalFindOne = adapter.findOne;
	wrapped.findOne = (async (input) => {
		const result = await originalFindOne(input);
		return transformSsoPayload(input.model, result, open);
	}) as BetterAuthAdapter["findOne"];

	const originalFindMany = adapter.findMany;
	wrapped.findMany = (async (input) => {
		const result = await originalFindMany(input);
		return result.map((item) => transformSsoPayload(input.model, item, open));
	}) as BetterAuthAdapter["findMany"];

	const originalUpdate = adapter.update;
	wrapped.update = (async (input) => {
		const result = await originalUpdate({
			...input,
			update: transformSsoPayload(
				input.model,
				input.update,
				seal
			) as typeof input.update,
		});
		return transformSsoPayload(input.model, result, open);
	}) as BetterAuthAdapter["update"];

	const originalUpdateMany = adapter.updateMany;
	wrapped.updateMany = (async (input) =>
		originalUpdateMany({
			...input,
			update: transformSsoPayload(
				input.model,
				input.update,
				seal
			) as typeof input.update,
		})) as BetterAuthAdapter["updateMany"];

	const originalTransaction = adapter.transaction;
	wrapped.transaction = (async (callback) =>
		originalTransaction((transactionAdapter) =>
			callback(
				wrapSsoProviderAdapter(
					transactionAdapter as unknown as BetterAuthAdapter
				) as Parameters<typeof callback>[0]
			)
		)) as BetterAuthAdapter["transaction"];

	return wrapped;
}

export function encryptedMongoAdapter(
	database: Parameters<typeof mongodbAdapter>[0],
	config?: Parameters<typeof mongodbAdapter>[1]
): ReturnType<typeof mongodbAdapter> {
	const adapterFactory = mongodbAdapter(database, config);
	return ((options: Parameters<typeof adapterFactory>[0]) =>
		wrapSsoProviderAdapter(adapterFactory(options))) as ReturnType<
		typeof mongodbAdapter
	>;
}
