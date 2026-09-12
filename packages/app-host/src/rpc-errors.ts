// Error transport shared by unary and streaming host RPC.

/** A structured error the host relays to a widget (decisions doc D6). `code` is a
 *  closed enum so the widget can branch without string matching; `message` is a
 *  human-readable detail. The legacy plugin path still uses a plain string error,
 *  so {@link RpcResponse.error} is a union and every reader must accept both. */
export interface RpcErrorPayload {
	code: WidgetRpcErrorCode;
	message: string;
}

/** The closed set of widget RPC error codes (decisions doc D6). */
export type WidgetRpcErrorCode =
	| "denied"
	| "not_found"
	| "over_budget"
	| "server_error"
	| "invalid_args";

const WIDGET_RPC_ERROR_CODES = new Set<string>([
	"denied",
	"not_found",
	"over_budget",
	"server_error",
	"invalid_args",
] satisfies WidgetRpcErrorCode[]);

function isWidgetRpcErrorCode(value: unknown): value is WidgetRpcErrorCode {
	return typeof value === "string" && WIDGET_RPC_ERROR_CODES.has(value);
}

/** Thrown (and caught into an RpcResponse.error) when a call is not permitted.
 *  Serialized to a plain STRING error (the legacy plugin path shape). */
export class CapabilityError extends Error {}

/** A widget round-trip failure carrying a closed {@link WidgetRpcErrorCode}
 *  (decisions doc D6). Serialized by the host into a structured
 *  `{ code, message }` error, distinct from {@link CapabilityError}'s string. */
export class CodedRpcError extends Error {
	code: WidgetRpcErrorCode;
	constructor(code: WidgetRpcErrorCode, message: string) {
		super(message);
		this.code = code;
		this.name = "CodedRpcError";
	}
}

/**
 * Serialize a thrown error into the `error` field of an {@link RpcResponse}. A
 * {@link CodedRpcError} (or anything carrying a PUBLIC widget `code`) becomes the
 * structured `{ code, message }` a widget expects (D6). An unknown string code is
 * normalized to `server_error` instead of escaping the closed wire vocabulary.
 * Everything else — notably the legacy {@link CapabilityError} — stays a plain
 * string so the existing plugin bridge (which checks `typeof error === "string"`)
 * is unaffected.
 */
export function toRpcError(err: unknown): string | RpcErrorPayload {
	if (
		err &&
		typeof err === "object" &&
		"code" in err &&
		typeof err.code === "string"
	) {
		const message =
			"message" in err && typeof err.message === "string"
				? err.message
				: String(err);
		return {
			code: isWidgetRpcErrorCode(err.code) ? err.code : "server_error",
			message,
		};
	}
	return err instanceof Error ? err.message : String(err);
}
