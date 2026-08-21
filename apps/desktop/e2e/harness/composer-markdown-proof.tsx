import { ComposerEditor } from "@ryu/ui/components/editor/composer-editor.tsx";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

const INITIAL_MARKDOWN = "";
const COMPOSER_PLACEHOLDER =
	"Paste a Markdown link here, then click it to edit the URL or display text.";

function ComposerMarkdownProof() {
	const [richMode, setRichMode] = useState(false);
	const [markdown, setMarkdown] = useState(INITIAL_MARKDOWN);

	return (
		<main className="min-h-screen bg-[#0b1020] px-6 py-10 text-slate-200">
			<div className="mx-auto max-w-3xl">
				<header className="mb-8 flex flex-wrap items-start justify-between gap-5">
					<div>
						<p className="font-medium text-indigo-300 text-sm uppercase tracking-[0.2em]">
							React verification artifact
						</p>
						<h1 className="mt-2 font-semibold text-4xl text-white tracking-tight">
							Rich Markdown composer
						</h1>
						<p className="mt-3 max-w-2xl text-slate-400">
							The production composer keeps the lightweight textarea by default.
							Turn on the Appearance setting below to mount the shared Plate
							editor for Markdown links, mentions, and common formatting.
						</p>
					</div>
					<div
						className={`rounded-full px-4 py-2 font-semibold text-sm ${richMode ? "bg-emerald-400/15 text-emerald-300" : "bg-slate-400/10 text-slate-400"}`}
						data-testid="mode-status"
					>
						{richMode ? "RICH MODE ON" : "LIGHTWEIGHT MODE"}
					</div>
				</header>

				<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl">
					<div className="flex items-center justify-between gap-4 border-white/10 border-b pb-4">
						<div>
							<h2 className="font-semibold text-lg text-white">Appearance</h2>
							<p className="mt-1 text-slate-400 text-sm">
								Settings → Appearance → Interface
							</p>
						</div>
						<label className="flex cursor-pointer items-center gap-3 font-medium text-sm">
							<span>Rich Markdown composer</span>
							<input
								aria-label="Rich Markdown composer"
								checked={richMode}
								onChange={(event) => setRichMode(event.target.checked)}
								type="checkbox"
							/>
						</label>
					</div>

					<div className="mt-5 rounded-2xl border border-indigo-300/20 bg-slate-950/70 p-4">
						<p className="mb-3 font-semibold text-indigo-200 text-xs uppercase tracking-[0.16em]">
							Composer
						</p>
						{richMode ? (
							<ComposerEditor
								markdown={markdown}
								onChange={setMarkdown}
								placeholder={COMPOSER_PLACEHOLDER}
							/>
						) : (
							<textarea
								aria-label="Lightweight composer"
								className="min-h-24 w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm outline-none placeholder:text-slate-500"
								onChange={(event) => setMarkdown(event.target.value)}
								placeholder={COMPOSER_PLACEHOLDER}
								value={markdown}
							/>
						)}
					</div>

					<div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
						<ProofNote label="Paste" value="Markdown links become clickable" />
						<ProofNote label="Edit" value="Click a link to change its target" />
						<ProofNote label="Mentions" value="Entity links stay special" />
					</div>
					<pre
						className="mt-5 overflow-auto rounded-xl border border-white/10 bg-black/20 p-3 text-slate-400 text-xs"
						data-testid="serialized-markdown"
					>
						{markdown}
					</pre>
				</section>
			</div>
		</main>
	);
}

function ProofNote({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-xl border border-white/10 bg-black/15 p-3">
			<div className="font-medium text-indigo-200 text-xs uppercase tracking-wide">
				{label}
			</div>
			<div className="mt-1 text-slate-400 leading-5">{value}</div>
		</div>
	);
}

createRoot(document.getElementById("root")!).render(<ComposerMarkdownProof />);
