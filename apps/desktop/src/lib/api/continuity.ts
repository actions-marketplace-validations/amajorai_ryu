import {
	parseRnpContinuityBundle,
	type RnpContextBundleV0,
	type RnpContinuityBundleV0,
	type RnpExportRequestV0,
	type RnpResumeResultV0,
} from "@ryuhq/protocol/continuity";
import { type ApiTarget, request } from "./client.ts";

export interface ContinuityTransport {
	send: (input: {
		body: unknown;
		path: string;
		target: ApiTarget;
	}) => Promise<unknown>;
}

export interface TransferConversationInput {
	context?: RnpContextBundleV0;
	conversationId: string;
	destination: ApiTarget;
	ifUpdatedAt?: number;
	includeAgentHint?: boolean;
	source: ApiTarget;
	transcript?: RnpExportRequestV0["transcript"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseResumeResult(value: unknown): RnpResumeResultV0 {
	if (!(isRecord(value) && value.version === 0)) {
		throw new Error("The destination returned an invalid continuity response.");
	}
	if (
		typeof value.conversationId !== "string" ||
		(value.status !== "created" &&
			value.status !== "merged" &&
			value.status !== "unchanged") ||
		!isRecord(value.imported) ||
		!isNonnegativeSafeInteger(value.imported.messages) ||
		!isNonnegativeSafeInteger(value.imported.contextItems) ||
		!Array.isArray(value.warnings) ||
		!value.warnings.every(
			(warning) =>
				warning === "agent-unavailable" ||
				warning === "earlier-messages-omitted"
		)
	) {
		throw new Error("The destination returned an invalid continuity response.");
	}
	return {
		version: 0,
		conversationId: value.conversationId,
		status: value.status,
		imported: {
			messages: value.imported.messages,
			contextItems: value.imported.contextItems,
		},
		warnings: value.warnings,
	};
}

const httpTransport: ContinuityTransport = {
	send: ({ body, path, target }) =>
		request<unknown>(target, path, { method: "POST", body }),
};

export function createContinuityClient(transport: ContinuityTransport) {
	const exportConversation = async (
		target: ApiTarget,
		conversationId: string,
		exportRequest: RnpExportRequestV0
	): Promise<RnpContinuityBundleV0> => {
		const path = `/api/rnp/v0/conversations/${encodeURIComponent(conversationId)}/export`;
		const raw = await transport.send({ target, path, body: exportRequest });
		const parsed = parseRnpContinuityBundle(raw);
		if (!parsed.ok) {
			throw new Error(
				`The source returned an invalid continuity bundle: ${parsed.error.message}`
			);
		}
		if (parsed.value.source.conversationId !== conversationId) {
			throw new Error("The source returned a different conversation.");
		}
		return parsed.value;
	};

	const resumeConversation = async (
		target: ApiTarget,
		bundle: RnpContinuityBundleV0
	): Promise<RnpResumeResultV0> => {
		const path = `/api/rnp/v0/conversations/${encodeURIComponent(bundle.source.conversationId)}/resume`;
		const raw = await transport.send({ target, path, body: bundle });
		const result = parseResumeResult(raw);
		if (result.conversationId !== bundle.source.conversationId) {
			throw new Error("The destination resumed a different conversation.");
		}
		return result;
	};

	const transferConversation = async (
		input: TransferConversationInput
	): Promise<RnpResumeResultV0> => {
		const bundle = await exportConversation(
			input.source,
			input.conversationId,
			{
				version: 0,
				ifUpdatedAt: input.ifUpdatedAt,
				transcript: input.transcript ?? { mode: "recent", maxMessages: 50 },
				context: input.context,
				includeAgentHint: input.includeAgentHint ?? false,
			}
		);
		return resumeConversation(input.destination, bundle);
	};

	return { exportConversation, resumeConversation, transferConversation };
}

const client = createContinuityClient(httpTransport);

export const exportRnpConversation = client.exportConversation;
export const resumeRnpConversation = client.resumeConversation;
export const transferRnpConversation = client.transferConversation;
