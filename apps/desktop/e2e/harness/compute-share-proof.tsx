import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/inter";
import { createRoot } from "react-dom/client";
import { ComputeShareSurface } from "../../src/components/exchange/ComputeShareSurface.tsx";
import "../../src/index.css";

const params = new URLSearchParams(window.location.search);
const mode = params.get("mode") === "share" ? "share" : "compute";
const theme = params.get("theme");
document.documentElement.classList.toggle("dark", theme === "dark");

const root = document.getElementById("root");
if (!root) {
	throw new Error("Compute/Share proof root is missing");
}

createRoot(root).render(
	<main className="h-screen bg-background text-foreground">
		<ComputeShareSurface mode={mode} />
	</main>
);
document.body.setAttribute("data-harness-ready", "1");
