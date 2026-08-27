import "@fontsource-variable/inter";
import { installHorizontalWheelScrolling } from "@ryu/ui/lib/horizontal-wheel-scroll";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Island } from "./components/Island.tsx";
import "./index.css";

const container = document.getElementById("root");
if (!container) {
	throw new Error("Root element #root not found");
}

installHorizontalWheelScrolling(document);

createRoot(container).render(
	<StrictMode>
		<Island />
	</StrictMode>
);
