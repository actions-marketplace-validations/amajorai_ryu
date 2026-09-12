import { Button } from "@ryu/ui/components/button.tsx";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import LoginPage from "../../../extension/pages/LoginPage.tsx";
import "../../src/index.css";
function App() {
	const [open, setOpen] = useState(true);
	return (
		<main className="h-screen">
			<Button onClick={() => setOpen(!open)}>
				{open ? "Close popup" : "Open popup"}
			</Button>
			{open && <LoginPage />}
		</main>
	);
}
createRoot(document.getElementById("root")!).render(<App />);
