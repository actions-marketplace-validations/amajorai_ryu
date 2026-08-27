import { createRoot } from "react-dom/client";
import { AgentChat } from "../../components/agent-elements/agent-chat.tsx";
import { EmptyStateHeader } from "../../components/agent-elements/empty-state-header.tsx";
import { ChatDisplayPrefs } from "../../src/components/chat/ChatDisplayPrefsProvider.tsx";
import "../../src/index.css";
import { useWorkspaceStore } from "../../src/store/useWorkspaceStore.ts";

const PROOF_FOLDER = "/Users/jiawei/Documents/Code/ryu";

useWorkspaceStore.setState({ folder: PROOF_FOLDER });

function Story() {
	return (
		<main className="h-screen bg-background text-foreground">
			<span
				aria-hidden="true"
				className="absolute text-muted-foreground opacity-0"
				data-testid="muted-foreground-reference"
			>
				Muted foreground reference
			</span>
			<ChatDisplayPrefs>
				<AgentChat
					currentUser={{ id: "proof-user", name: "You" }}
					emptyStateHeader={
						<EmptyStateHeader
							logo={{ kind: "single", engine: "ryu" }}
							renderBody={() => null}
							sections={[]}
						/>
					}
					emptyStatePosition="center"
					messages={[]}
					onSend={() => undefined}
					status="ready"
				/>
			</ChatDisplayPrefs>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
