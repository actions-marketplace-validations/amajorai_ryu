import { Button } from "@ryu/ui/components/button.tsx";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConnectionStatusToast } from "../../../extension/components/shell/ConnectionStatusToast.tsx";
import { startContentConnectionStatus } from "../../../extension/lib/content-connection-status.ts";
import { InPageUi } from "../../../extension/lib/in-page-ui.ts";
import { useNodeStore } from "./extension-health-node.ts";
import "../../src/index.css";
function ContentMonitor() {
	useEffect(() => {
		const ui = new InPageUi();
		const stop = startContentConnectionStatus(
			{
				showConnectionStatus: (phase, name, restored) => {
					document.documentElement.dataset.contentPhase = phase;
					ui.showConnectionStatus(phase, name, restored);
				},
				hideConnectionStatus: () => {
					document.documentElement.dataset.contentPhase = "hidden";
					ui.hideConnectionStatus();
				},
			},
			async () => {
				const response = await fetch("http://127.0.0.1:5215/alpha/api/health");
				return { ok: true, reachable: response.ok };
			}
		);
		return () => {
			stop();
			ui.unmount();
		};
	}, []);
	return null;
}
function App() {
	const [mounted, setMounted] = useState(true);
	return (
		<main className="min-h-screen bg-background p-10 text-foreground">
			<h1 className="mb-4 font-semibold text-2xl">Ryu browser workspace</h1>
			<p className="mb-6 text-muted-foreground">
				Your workspace remains available while the node reconnects.
			</p>
			<div className="flex gap-3">
				<Button
					onClick={() =>
						useNodeStore.setState({
							node: {
								name: "Beta",
								url: "http://127.0.0.1:5215/beta",
								token: null,
							},
						})
					}
				>
					Beta node
				</Button>
				<Button onClick={() => setMounted(!mounted)}>
					{mounted ? "Close monitor" : "Open monitor"}
				</Button>
			</div>
			{mounted &&
				(location.search.includes("content") ? (
					<ContentMonitor />
				) : (
					<ConnectionStatusToast />
				))}
		</main>
	);
}
createRoot(document.getElementById("root")!).render(<App />);
