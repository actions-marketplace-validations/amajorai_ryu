import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
	type ForkDestination,
	ForkDialog,
} from "../../src/components/chat/ForkDialog.tsx";
import "../../src/index.css";

function Story() {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [selectedDestination, setSelectedDestination] =
		useState<ForkDestination | null>(null);

	return (
		<main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
			<div className="flex w-full max-w-md flex-col gap-4 rounded-3xl border bg-card p-6 shadow-sm">
				<div>
					<p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
						Fork action proof
					</p>
					<h1 className="mt-2 font-semibold text-xl tracking-tight">
						Choose where this branch should run
					</h1>
				</div>
				<button
					className="h-10 rounded-xl bg-primary px-4 font-medium text-primary-foreground text-sm"
					data-testid="open-fork-dialog"
					onClick={() => setDialogOpen(true)}
					type="button"
				>
					Fork chat from here
				</button>
				<output
					className="text-muted-foreground text-sm"
					data-testid="selection"
				>
					{selectedDestination
						? `Selected: ${selectedDestination}`
						: "No destination selected"}
				</output>
			</div>
			<ForkDialog
				onOpenChange={setDialogOpen}
				onSelect={(destination) => {
					setSelectedDestination(destination);
					setDialogOpen(false);
				}}
				open={dialogOpen}
			/>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
