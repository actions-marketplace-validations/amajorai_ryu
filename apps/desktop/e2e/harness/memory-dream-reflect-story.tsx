import { createRoot } from "react-dom/client";
import { MemoryDreamReview } from "../../src/components/memory/MemoryDreamReview.tsx";
import { MemoryReflectDashboard } from "../../src/components/memory/MemoryReflectDashboard.tsx";
import type { ApiTarget } from "../../src/lib/api/client.ts";
import "../../src/index.css";

const target: ApiTarget = { token: null, url: window.location.origin };

function Story() {
	return (
		<div className="min-h-screen bg-background px-6 py-10 text-foreground">
			{new URLSearchParams(window.location.search).get("view") === "reflect" ? (
				<MemoryReflectDashboard target={target} />
			) : (
				<MemoryDreamReview target={target} />
			)}
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
