import { createRoot } from "react-dom/client";
import { AdminAnnouncements } from "../../../web/src/components/admin-announcements.tsx";
import "../../src/index.css";
createRoot(document.getElementById("root")!).render(
	<main className="mx-auto max-w-4xl p-8">
		<h1 className="mb-6 font-semibold text-2xl">Announcements</h1>
		<AdminAnnouncements />
	</main>
);
