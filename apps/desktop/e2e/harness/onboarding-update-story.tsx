import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
	type UpdateStepStatus,
	UpdateStepView,
} from "../../src/components/onboarding/UpdateStep.tsx";
import "../../src/index.css";

function Story() {
	const [status, setStatus] = useState<UpdateStepStatus>("available");
	const [automaticDownload, setAutomaticDownload] = useState(true);
	const [completed, setCompleted] = useState(false);

	return (
		<main
			className="h-screen bg-background text-foreground"
			data-testid="onboarding-update-proof"
		>
			<UpdateStepView
				automaticDownload={automaticDownload}
				availableVersion="0.1.16"
				onContinue={() => setCompleted(true)}
				onInstall={() => setStatus("checking")}
				onToggleAutomaticDownload={setAutomaticDownload}
				prepared={true}
				status={status}
			/>
			<output className="sr-only" data-testid="onboarding-update-state">
				{completed ? "completed" : status}
			</output>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
