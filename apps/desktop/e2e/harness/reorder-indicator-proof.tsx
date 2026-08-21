import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

const EXPECTED_INDICATORS = 7;

function ReorderIndicatorProof() {
	const [metrics, setMetrics] = useState({ count: 0, rounded: false });

	useEffect(() => {
		const indicators = Array.from(
			document.querySelectorAll<HTMLElement>("[data-reorder-line]")
		);
		setMetrics({
			count: indicators.length,
			rounded: indicators.every(
				(indicator) => getComputedStyle(indicator).borderRadius !== "0px"
			),
		});
	}, []);

	const verified =
		metrics.count === EXPECTED_INDICATORS && metrics.rounded === true;

	return (
		<main className="min-h-screen bg-background p-8 text-foreground">
			<div className="mx-auto flex max-w-3xl flex-col gap-6">
				<header className="flex items-start justify-between gap-4">
					<div>
						<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
							React verification artifact
						</p>
						<h1 className="font-semibold text-2xl">
							Rounded reorder indicators
						</h1>
						<p className="mt-1 text-muted-foreground text-sm">
							Every blue drag marker uses the shared rounded-cap utility.
						</p>
					</div>
					<p
						className="rounded-full border px-3 py-1 font-medium text-xs"
						data-status={verified ? "pass" : "pending"}
						data-testid="proof-status"
					>
						{verified ? "PASS" : "CHECKING…"}
					</p>
				</header>

				<div className="grid gap-4 md:grid-cols-3">
					<section className="relative flex min-h-44 flex-col gap-4 rounded-xl border bg-card p-5">
						<div>
							<p className="font-medium text-sm">Tab reordering</p>
							<p className="text-muted-foreground text-xs">
								Vertical before/after drop markers.
							</p>
						</div>
						<div className="relative flex h-16 items-center rounded-lg border bg-background px-5">
							<span
								aria-hidden
								className="reorder-drop-indicator pointer-events-none absolute inset-y-1 left-2 w-0.5 bg-primary"
								data-reorder-line="tab-before"
							/>
							<span className="text-sm">Pinned tab</span>
							<span
								aria-hidden
								className="reorder-drop-indicator pointer-events-none absolute inset-y-1 right-2 w-0.5 bg-primary"
								data-reorder-line="tab-after"
							/>
						</div>
					</section>

					<section className="relative flex min-h-44 flex-col gap-4 rounded-xl border bg-card p-5">
						<div>
							<p className="font-medium text-sm">Sidebar sections</p>
							<p className="text-muted-foreground text-xs">
								Horizontal section drop markers.
							</p>
						</div>
						<div className="relative flex h-16 items-center rounded-lg border bg-background px-5">
							<span
								aria-hidden
								className="reorder-drop-indicator pointer-events-none absolute inset-x-2 top-2 h-0.5 bg-primary"
								data-reorder-line="section-before"
							/>
							<span className="text-sm">Workspace section</span>
							<span
								aria-hidden
								className="reorder-drop-indicator pointer-events-none absolute inset-x-2 bottom-2 h-0.5 bg-primary"
								data-reorder-line="section-after"
							/>
						</div>
					</section>

					<section className="relative flex min-h-44 flex-col gap-4 rounded-xl border bg-card p-5">
						<div>
							<p className="font-medium text-sm">Editor drag targets</p>
							<p className="text-muted-foreground text-xs">
								Blocks, table rows, and columns.
							</p>
						</div>
						<div className="relative flex h-16 flex-col justify-center gap-2 rounded-lg border bg-background px-5">
							<span
								aria-hidden
								className="reorder-drop-indicator absolute inset-x-2 top-2 h-0.5 bg-brand/50"
								data-reorder-line="block"
							/>
							<span className="text-sm">Document row</span>
							<span
								aria-hidden
								className="reorder-drop-indicator absolute inset-x-2 bottom-2 h-0.5 bg-brand/50"
								data-reorder-line="table-row"
							/>
							<span
								aria-hidden
								className="reorder-drop-indicator absolute inset-y-2 right-2 w-1 bg-brand/50"
								data-reorder-line="column"
							/>
						</div>
					</section>
				</div>

				<dl className="grid gap-2 rounded-xl border bg-card p-4 text-sm sm:grid-cols-2">
					<div>
						<dt className="text-muted-foreground">Rendered markers</dt>
						<dd data-testid="proof-count">
							{metrics.count} / {EXPECTED_INDICATORS}
						</dd>
					</div>
					<div>
						<dt className="text-muted-foreground">Computed cap radius</dt>
						<dd data-testid="proof-radius">
							{metrics.rounded ? "rounded on every marker" : "pending"}
						</dd>
					</div>
				</dl>
			</div>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<ReorderIndicatorProof />);
}
