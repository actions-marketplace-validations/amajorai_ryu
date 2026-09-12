import { Button } from "@ryu/ui/components/button.tsx";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TopupSettlement } from "../../../web/src/app/success/topup-settlement.tsx";
import "../../src/index.css";
function App() {
	const [checkout, setCheckout] = useState("first");
	const [open, setOpen] = useState(true);
	return (
		<main className="min-h-screen bg-background p-8 text-foreground">
			<h1 className="mb-6 font-semibold text-2xl">Wallet update</h1>
			<div className="flex gap-3">
				<Button onClick={() => setCheckout("second")}>Next checkout</Button>
				<Button onClick={() => setOpen(!open)}>
					{open ? "Close receipt" : "Open receipt"}
				</Button>
			</div>
			{open && <TopupSettlement checkoutId={checkout} />}
		</main>
	);
}
createRoot(document.getElementById("root")!).render(<App />);
