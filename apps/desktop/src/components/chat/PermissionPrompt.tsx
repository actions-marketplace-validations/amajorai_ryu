"use client";

import {
	ToolApproval,
	type ToolApprovalChoice,
	ToolApprovalCode,
} from "@ryu/ui/components/agents/tool-approval";
import { memo, useMemo } from "react";
import type { AcpPermissionOption } from "@/src/lib/api/acp.ts";

export interface ActivePermission {
	options: AcpPermissionOption[];
	requestId: string;
	toolCall: unknown;
}

export interface PermissionPromptProps {
	onRespond: (optionId: string | null) => void;
	permission: ActivePermission;
}

interface ToolCallShape {
	fields?: ToolCallShape;
	kind?: string;
	locations?: { line?: number; path?: string }[];
	rawInput?: Record<string, unknown>;
	title?: string;
}

/** Best-effort human label for the tool the agent wants to run. */
function toolTitle(toolCall: unknown): string {
	const tc = toolCall as ToolCallShape | null | undefined;
	return tc?.title ?? tc?.fields?.title ?? "run a tool";
}

/**
 * `ToolCallUpdate` carries its mutable fields behind a flattened `fields`
 * object in some agents' output and inline in others, so read through both.
 */
function toolFields(toolCall: unknown): ToolCallShape {
	const tc = (toolCall ?? {}) as ToolCallShape;
	return { ...tc.fields, ...tc };
}

/** The shell command an exec-kind call wants to run, if it named one. */
function toolCommand(fields: ToolCallShape): string | null {
	const raw = fields.rawInput;
	if (!raw) {
		return null;
	}
	for (const key of ["command", "cmd", "script"]) {
		const value = raw[key];
		if (typeof value === "string" && value.trim()) {
			return value;
		}
	}
	return null;
}

const HIDDEN_PARAMETER_KEYS = new Set(["command", "cmd", "script"]);
const MAX_PARAMETER_LENGTH = 200;

function formatParameterValue(value: unknown): string {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	if (!text) {
		return "";
	}
	return text.length > MAX_PARAMETER_LENGTH
		? `${text.slice(0, MAX_PARAMETER_LENGTH)}…`
		: text;
}

const ALLOW_KINDS = new Set(["allow_once", "allow_always"]);

function toneForKind(kind: string): ToolApprovalChoice["tone"] {
	if (kind === "allow_once") {
		return "primary";
	}
	if (ALLOW_KINDS.has(kind)) {
		return "secondary";
	}
	return "ghost";
}

/**
 * Inline allow/reject prompt shown above the composer when an ACP agent in a
 * permission-gating mode asks to run a tool (Zed-style). One button per
 * agent-reported option; the chosen option id is sent back to Core to unblock
 * the awaiting turn.
 *
 * This is the FALLBACK surface. When the request names a tool call that already
 * has a row in the thread, ChatPage renders the approval on that row instead so
 * the question sits next to the command it is about — see `permissionsByToolCall`.
 */
export const PermissionPrompt = memo(function PermissionPrompt({
	permission,
	onRespond,
}: PermissionPromptProps) {
	const title = useMemo(
		() => toolTitle(permission.toolCall),
		[permission.toolCall]
	);
	const fields = useMemo(
		() => toolFields(permission.toolCall),
		[permission.toolCall]
	);
	const command = useMemo(() => toolCommand(fields), [fields]);

	const parameters = useMemo(() => {
		const raw = fields.rawInput;
		if (!raw) {
			return [];
		}
		return Object.entries(raw)
			.filter(([key]) => !HIDDEN_PARAMETER_KEYS.has(key))
			.map(([key, value]) => ({
				id: key,
				label: key,
				value: formatParameterValue(value),
			}))
			.filter((row) => row.value !== "");
	}, [fields]);

	const choices = useMemo<ToolApprovalChoice[]>(
		() =>
			permission.options.map((option) => ({
				id: option.optionId,
				label: option.name,
				tone: toneForKind(option.kind),
				onSelect: () => onRespond(option.optionId),
			})),
		[onRespond, permission.options]
	);

	return (
		<div className="mx-auto mb-1 w-full max-w-[720px] px-3">
			<ToolApproval
				choices={choices}
				description={`Allow the agent to ${title}?`}
				parameters={parameters}
				status="pending"
				title="Permission required"
				tool={fields.kind ? `${fields.kind} · ${title}` : title}
			>
				{command ? <ToolApprovalCode code={command} language="bash" /> : null}
			</ToolApproval>
		</div>
	);
});
