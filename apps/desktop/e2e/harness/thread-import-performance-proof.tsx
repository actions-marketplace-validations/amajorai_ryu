import { Button } from "@ryu/ui/components/button";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ImportThreadsDialog } from "@/src/components/chat/ImportThreadsDialog.tsx";
import { useAutoThreadImport } from "@/src/hooks/useAutoThreadImport.ts";
import type { AgentSummary } from "@/src/lib/api/agents.ts";
import "../../src/index.css";
const agents = [
	{ id: "codex", name: "Codex", engine: "codex" },
] as AgentSummary[];
function App() {
	const [open, setOpen] = useState(false);
	const [refresh, setRefresh] = useState(0);
	const [token, setToken] = useState<string | null>(null);
	const [imported, setImported] = useState(0);
	const target = { url: window.location.origin, token };
	useAutoThreadImport({
		agents,
		target,
		onImported: () => setImported((value) => value + 1),
	});
	useEffect(() => {
		const repaint = () => setRefresh((value) => value + 1);
		const changeIdentity = () => setToken("synthetic-proof-token");
		window.addEventListener("proof-identity", changeIdentity);
		window.addEventListener("proof-repaint", repaint);
		return () => {
			window.removeEventListener("proof-identity", changeIdentity);
			window.removeEventListener("proof-repaint", repaint);
		};
	}, []);
	return (
		<main className="min-h-screen bg-background p-8 text-foreground">
			<h1 className="mb-4 font-semibold text-2xl">Agent conversations</h1>
			<p className="mb-4 text-muted-foreground">
				{imported} automatic imports completed
			</p>
			<span className="sr-only" data-testid="refresh">
				{refresh}
			</span>
			<Button onClick={() => setOpen(true)}>Import a thread</Button>
			<ImportThreadsDialog
				agents={agents}
				onImported={() => setImported((value) => value + 1)}
				onOpenChange={setOpen}
				open={open}
				target={target}
			/>
		</main>
	);
}
const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<App />);
}
