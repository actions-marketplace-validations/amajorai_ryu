import { createContext, type ReactNode, useContext } from "react";

export interface AgentUiSubmissionState {
	pending: boolean;
	submitted: boolean;
}

const AgentUiSubmissionContext = createContext<AgentUiSubmissionState>({
	pending: false,
	submitted: false,
});

export function AgentUiSubmissionStateProvider({
	children,
	state,
}: {
	children: ReactNode;
	state: AgentUiSubmissionState;
}) {
	return (
		<AgentUiSubmissionContext.Provider value={state}>
			{children}
		</AgentUiSubmissionContext.Provider>
	);
}

export function useAgentUiSubmissionState(): AgentUiSubmissionState {
	return useContext(AgentUiSubmissionContext);
}
