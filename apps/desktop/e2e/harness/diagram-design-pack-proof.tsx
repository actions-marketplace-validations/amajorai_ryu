import { createRoot } from "react-dom/client";
import "../../src/index.css";

interface Check {
	detail: string;
	label: string;
	status: "PASS" | "LIVE";
}

const checks: Check[] = [
	{
		detail: "apps/core/src/skills_catalog/packs.rs",
		label: "Core built-in pack catalog",
		status: "PASS",
	},
	{
		detail: "Derived by system_skills::bundled_repos()",
		label: "Boot sync includes the repository",
		status: "PASS",
	},
	{
		detail: "packages/api/src/routers/catalog.ts",
		label: "Public pack shelf mirror",
		status: "PASS",
	},
	{
		detail: "skills/diagram-design/SKILL.md · MIT",
		label: "Upstream skill package",
		status: "LIVE",
	},
];

function CheckRow({ detail, label, status }: Check): React.JSX.Element {
	return (
		<li className="flex items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0">
			<div>
				<p className="font-medium text-slate-100">{label}</p>
				<p className="text-slate-400 text-sm">{detail}</p>
			</div>
			<span
				className={`rounded-full px-2.5 py-1 font-semibold text-xs tracking-wide ${
					status === "PASS"
						? "bg-emerald-400/15 text-emerald-300"
						: "bg-sky-400/15 text-sky-300"
				}`}
			>
				{status}
			</span>
		</li>
	);
}

function ProofArtifact(): React.JSX.Element {
	return (
		<main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
			<div className="mx-auto max-w-3xl space-y-8">
				<header className="space-y-3">
					<p className="font-semibold text-sky-300 text-sm uppercase tracking-[0.2em]">
						Ryu verification artifact
					</p>
					<h1 className="font-semibold text-4xl tracking-tight">
						Diagram Design is bundled as a built-in pack
					</h1>
					<p className="max-w-2xl text-slate-300">
						Core boot sync and the public pack shelf point to the same upstream
						repository without vendoring its skill body.
					</p>
				</header>

				<section
					aria-label="Pack summary"
					className="grid gap-4 sm:grid-cols-3"
				>
					<div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
						<p className="text-slate-400 text-sm">Pack</p>
						<p className="mt-2 font-semibold text-xl">
							cathrynlavery/diagram-design
						</p>
					</div>
					<div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
						<p className="text-slate-400 text-sm">Upstream skill</p>
						<p className="mt-2 font-semibold text-xl">27 visual types</p>
					</div>
					<div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
						<p className="text-slate-400 text-sm">Ownership</p>
						<p className="mt-2 font-semibold text-emerald-300 text-xl">
							Built-in
						</p>
					</div>
				</section>

				<section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
					<div className="border-slate-800 border-b px-4 py-3">
						<h2 className="font-semibold">Completed checks</h2>
					</div>
					<ul>
						{checks.map((check) => (
							<CheckRow key={check.label} {...check} />
						))}
					</ul>
				</section>

				<a
					className="inline-flex rounded-lg border border-sky-400/40 px-4 py-2 text-sky-200 text-sm transition hover:bg-sky-400/10"
					href="https://www.skills.sh/cathrynlavery/diagram-design"
					rel="noopener noreferrer"
					target="_blank"
				>
					Open upstream pack
				</a>
			</div>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<ProofArtifact />);
}
