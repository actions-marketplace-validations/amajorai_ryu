import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/inter";
import { createRoot } from "react-dom/client";
import { CrashBoundary } from "../../src/components/CrashBoundary.tsx";
import "../../src/index.css";

function CrashingChild(): never {
	throw new Error("Crash boundary visual proof");
}

const theme = new URLSearchParams(window.location.search).get("theme");
document.documentElement.classList.toggle("dark", theme === "dark");

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Crash boundary proof root is missing");
}

createRoot(rootElement).render(
	<CrashBoundary>
		<CrashingChild />
	</CrashBoundary>
);

document.body.setAttribute("data-harness-ready", "1");
