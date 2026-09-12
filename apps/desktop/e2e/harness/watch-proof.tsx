import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import PageHeader from "@ryu/ui/components/page-header.tsx";
import { UserNotificationSettings } from "../../../web/src/components/user-notification-settings.tsx";
import { WatchDashboard } from "../../../web/src/components/watch-dashboard.tsx";
import "./watch-proof.css";

const root = document.getElementById("root");
if (!root) {
	throw new Error("Missing proof root");
}
createRoot(root).render(
	<main className="mx-auto max-w-6xl space-y-6 p-6 sm:p-10">
		<p className="text-muted-foreground text-xs">
			Local verification · Synthetic enrolled assets · No external email
			delivery
		</p>
		<PageHeader
			subtitle="Platform security monitoring, private findings, and verification coverage."
			title="Ryu Watch"
		/>
		{new URLSearchParams(window.location.search).has("notifications") ? (
			<UserNotificationSettings />
		) : (
			<WatchDashboard admin apiBase="/api/watch" />
		)}
	</main>
);
