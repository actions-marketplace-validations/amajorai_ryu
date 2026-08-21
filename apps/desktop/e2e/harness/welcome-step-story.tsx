import { useState } from "react";
import { createRoot } from "react-dom/client";
import { WelcomeStep } from "../../src/components/onboarding/WelcomeStep.tsx";
import "../../src/index.css";

function Story() {
	const [completed, setCompleted] = useState(false);

	return (
		<main
			className="h-screen bg-background text-foreground"
			data-testid="welcome-step-proof"
		>
			<WelcomeStep onContinue={() => setCompleted(true)} />
			<output className="sr-only" data-testid="onboarding-status">
				{completed ? "completed" : "active"}
			</output>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
