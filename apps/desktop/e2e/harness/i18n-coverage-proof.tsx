import { I18nProvider, useI18n } from "@ryu/i18n/react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

function ProofSurface() {
	return (
		<I18nProvider initialPackId="official/es">
			<main
				className="min-h-dvh bg-background p-8 text-foreground"
				data-testid="i18n-coverage-proof"
			>
				<div className="mx-auto flex max-w-2xl flex-col gap-6">
					<header className="rounded-2xl border bg-card p-6 shadow-sm">
						<p className="text-muted-foreground text-xs uppercase tracking-wide">
							Shared runtime proof
						</p>
						<h1>Activity</h1>
						<p className="text-muted-foreground">
							Raw legacy copy, attributes, and dynamic content remain on their
							approved localization paths.
						</p>
					</header>
					<section className="rounded-2xl border bg-card p-6 shadow-sm">
						<div className="flex items-center gap-3">
							<LocaleSwitch />
							<button aria-label="Cancel" type="button">
								Cancel
							</button>
							<input placeholder="Search" title="Status" />
						</div>
						<p data-testid="dynamic-content">Project Alpha</p>
						<pre data-testid="code-content">Cancel</pre>
					</section>
				</div>
			</main>
		</I18nProvider>
	);
}

function LocaleSwitch() {
	const { selectPack } = useI18n();
	return (
		<button
			data-testid="switch-arabic"
			onClick={() => selectPack("official/ar")}
			type="button"
		>
			Switch to Arabic
		</button>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<ProofSurface />);
}
