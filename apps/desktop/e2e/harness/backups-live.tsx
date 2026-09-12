import { createRoot } from "react-dom/client";
import { BackupSettings } from "../../src/components/settings/BackupSettings.tsx";
import "../../src/index.css";

const target = {
	url: "http://127.0.0.1:18980",
	token: "ryu-backup-local-proof",
};
const params = new URLSearchParams(window.location.search);
document.documentElement.classList.toggle(
	"dark",
	params.get("theme") === "dark"
);
const root = document.getElementById("root");
if (!root) {
	throw new Error("Missing root");
}
createRoot(root).render(
	<div className="min-h-screen bg-background text-foreground">
		<main className="mx-auto max-w-3xl px-6 py-10">
			<p className="mb-2 text-muted-foreground text-sm">
				Node settings · Local verification node
			</p>
			<h1 className="mb-8 font-medium text-2xl">Storage</h1>
			<BackupSettings
				spaceId={params.get("spaceId") ?? undefined}
				target={target}
			/>
		</main>
	</div>
);
