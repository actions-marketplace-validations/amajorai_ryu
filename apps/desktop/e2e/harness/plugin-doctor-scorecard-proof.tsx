import { createRoot } from "react-dom/client";
import { ScorecardPanel } from "../../../../packages/marketplace/src/catalog/detail/scorecard-panel.tsx";
import {
	runScorecard,
	type Scorecard,
} from "../../../../packages/marketplace/src/catalog/scorecard.ts";
import type {
	CatalogEntry,
	PluginCatalogDetail,
} from "../../../../packages/marketplace/src/catalog/types.ts";
import "../../src/index.css";

const entry: CatalogEntry = {
	description: "A mail app with a clear, focused job.",
	id: "com.example.mail",
	kinds: ["tool"],
	name: "Example Mail",
	tags: ["productivity"],
	version: "1.4.2",
};

const detail: PluginCatalogDetail = {
	archived: false,
	description: entry.description,
	engines: { ryu: ">=0.3.0" },
	issuesEnabled: true,
	license: "MIT",
	origin: "first-party",
	permissions: { declared: true, network: ["https://api.example.com"] },
	privacyPolicyUrl: "https://example.com/privacy",
	readme: "# Example Mail\n\n".concat("Useful documentation. ".repeat(30)),
	repositoryUrl: "https://example.com/mail",
	reviewed: true,
	surfaces: ["desktop"],
	termsOfServiceUrl: "https://example.com/terms",
	updatedAt: "2026-08-01T00:00:00Z",
	version: entry.version,
	versions: [{ publishedAt: "2026-08-01T00:00:00Z", version: entry.version }],
};

const scorecard: Scorecard = runScorecard(
	entry,
	detail,
	Date.parse("2026-08-17")
);

function Story() {
	return (
		<main className="min-h-svh bg-background p-8 text-foreground">
			<div className="mx-auto max-w-3xl">
				<p className="text-muted-foreground text-xs uppercase tracking-[0.2em]">
					Ryu · Marketplace React proof
				</p>
				<h1 className="mt-2 font-semibold text-3xl">Health + Plugin Doctor</h1>
				<p className="mt-2 max-w-2xl text-muted-foreground text-sm">
					The catalog score and the installed runtime doctor are shown as
					separate layers, with one handoff command for developers.
				</p>
				<section className="mt-6 rounded-xl border bg-card p-6">
					<ScorecardPanel
						developerCommand="ryu plugin doctor com.example.mail"
						scorecard={scorecard}
					/>
				</section>
				<p
					className="mt-4 font-medium text-emerald-600"
					data-testid="proof-status"
				>
					VERIFIED
				</p>
			</div>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
document.body.setAttribute("data-harness-ready", "1");
