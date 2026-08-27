import "@fontsource-variable/geist";
import "@fontsource-variable/inter";
import { LoginView } from "@ryu/blocks/desktop/login.tsx";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

const root = document.getElementById("root");
if (!root) {
	throw new Error("Missing proof root");
}

createRoot(root).render(
	<div className="h-screen bg-background text-foreground">
		<LoginView
			localCoreSetup={{
				fileName: "ryu-core-macos-aarch64",
				phase: "waiting",
			}}
			onContinueAsGuest={() => undefined}
			onDownloadCoreAgain={() => undefined}
			onUseCloud={() => undefined}
		/>
	</div>
);
