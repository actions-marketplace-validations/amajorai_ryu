import { engineForAgent } from "./agent-logos.tsx";

/** Engines whose native history Core can read. */
export const HISTORY_ENGINE_HINT = /claude|codex/i;

export function agentSupportsHistoryHint(
	agent: Pick<
		{
			builtIn?: boolean | null;
			engine?: string | null;
			id: string;
		},
		"builtIn" | "engine" | "id"
	>
): boolean {
	const engine = engineForAgent(agent);
	return engine ? HISTORY_ENGINE_HINT.test(engine) : false;
}
