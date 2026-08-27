import type { ReconnectRetryState } from "@/src/hooks/useReconnectRetry.ts";

export function ReconnectRetryBanner({
	state,
}: {
	state: ReconnectRetryState;
}) {
	if (state.phase === "idle") {
		return null;
	}

	const copy = {
		complete: {
			detail: `${state.retriedCount} ${state.retriedCount === 1 ? "chat is" : "chats are"} running again.`,
			title: "Connection restored",
		},
		error: {
			detail:
				"Ryu kept the failed candidates bounded; you can retry them from their chat tabs.",
			title: "Reconnect retry needs attention",
		},
		offline: {
			detail: `${state.candidateCount} active ${state.candidateCount === 1 ? "chat is" : "chats are"} queued for one retry when the node returns.`,
			title: "Connection lost",
		},
		retrying: {
			detail: `Starting one retry for ${state.candidateCount} ${state.candidateCount === 1 ? "chat" : "chats"}…`,
			title: "Connection restored",
		},
	}[state.phase];

	return (
		<output
			aria-live="polite"
			className="flex w-full items-center gap-3 border-border border-b bg-primary/5 px-4 py-2 text-sm"
			data-testid="reconnect-retry-status"
		>
			<span className="font-medium">{copy.title}</span>
			<span className="text-muted-foreground">{copy.detail}</span>
		</output>
	);
}
