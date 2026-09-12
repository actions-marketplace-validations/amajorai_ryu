import { Button } from "@ryu/ui/components/button.tsx";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import ToolsLibrary from "@/src/components/tools/ToolsLibrary.tsx";
import { EntitlementProvider } from "@/src/contexts/entitlement-context.tsx";
import { useAgents } from "@/src/hooks/useAgents.ts";
import { useMcp } from "@/src/hooks/useMcp.ts";
import { queryClient } from "@/src/lib/query-client.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import "../../src/index.css";
useNodeStore.setState({
	nodes: [
		{
			name: "Performance node",
			url: "http://127.0.0.1:5211",
			token: null,
			userJwt: null,
		},
	],
	defaultNode: "Performance node",
	autoSelect: false,
});
function Reader() {
	useMcp();
	return null;
}
function AgentReader() {
	const roster = useAgents();
	return (
		<Button
			onClick={() =>
				roster.update("agent-a", {
					name: "Updated research agent",
					description: null,
					engine: null,
					systemPrompt: null,
					tools: [],
				})
			}
		>
			Rename research agent
		</Button>
	);
}
function App() {
	const [count, setCount] = useState(3);
	return (
		<QueryClientProvider client={queryClient}>
			<main className="h-screen p-6">
				<header className="mb-4 flex items-center gap-4">
					<span className="text-muted-foreground text-sm">
						Tools library · shared with chat and sidebar readers
					</span>
					<Button onClick={() => setCount(4)}>Add consumer</Button>
					{new URLSearchParams(location.search).has("agents") && (
						<EntitlementProvider>
							<AgentReader />
						</EntitlementProvider>
					)}
				</header>
				{["chat-a", "chat-b", "sidebar", "warm"].slice(0, count).map((id) => (
					<Reader key={id} />
				))}
				<ToolsLibrary />
			</main>
		</QueryClientProvider>
	);
}
createRoot(document.getElementById("root")!).render(<App />);
