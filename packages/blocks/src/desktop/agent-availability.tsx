"use client";

import { cn } from "@ryu/ui/lib/utils";
import { createContext, type ReactNode, useContext } from "react";

/** Availability states that can change how an agent asks for human input. */
export const AGENT_AVAILABILITY_OPTIONS = [
	{
		value: "online",
		label: "Online",
		description: "Ask questions and surface prompts as soon as they are ready.",
	},
	{
		value: "away",
		label: "Away",
		description: "Keep questions in the transcript until you return.",
	},
	{
		value: "do-not-disturb",
		label: "Do not disturb",
		description:
			"Keep prompts out of the composer until you switch back to Online.",
	},
] as const;

export type AgentAvailabilityStatus =
	(typeof AGENT_AVAILABILITY_OPTIONS)[number]["value"];

/** Defensive status guard for host-owned settings and persisted values. */
export function isAgentAvailabilityStatus(
	value: unknown
): value is AgentAvailabilityStatus {
	return AGENT_AVAILABILITY_OPTIONS.some((option) => option.value === value);
}

/** Display label for a status without duplicating the option table in hosts. */
export function agentAvailabilityLabel(
	status: AgentAvailabilityStatus
): string {
	return (
		AGENT_AVAILABILITY_OPTIONS.find((option) => option.value === status)
			?.label ?? "Online"
	);
}

/** Small semantic status marker shared by account chrome and settings previews. */
export function AgentAvailabilityDot({
	className,
	status,
}: {
	className?: string;
	status: AgentAvailabilityStatus;
}) {
	const tone = {
		online: "bg-success",
		away: "bg-warning",
		"do-not-disturb": "bg-destructive",
	}[status];

	return (
		<span
			aria-hidden="true"
			className={cn("size-2 shrink-0 rounded-full", tone, className)}
		/>
	);
}

const AgentAvailabilityContext =
	createContext<AgentAvailabilityStatus>("online");

/**
 * Host bridge for the shared chat primitives.
 *
 * Desktop owns detection and persistence; blocks only needs the resolved status
 * so every AgentChat consumer applies the same prompt policy without importing a
 * host-specific store.
 */
export function AgentAvailabilityProvider({
	children,
	status,
}: {
	children: ReactNode;
	status: AgentAvailabilityStatus;
}) {
	return (
		<AgentAvailabilityContext value={status}>
			{children}
		</AgentAvailabilityContext>
	);
}

/** Resolved availability for the current host window. */
export function useAgentAvailability(): AgentAvailabilityStatus {
	return useContext(AgentAvailabilityContext);
}
