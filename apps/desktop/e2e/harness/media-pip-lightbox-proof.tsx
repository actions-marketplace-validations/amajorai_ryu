import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MediaPipDock } from "../../src/components/media/MediaPip.tsx";
import {
	clearMediaSource,
	type MediaSourceKind,
	publishMediaSource,
} from "../../src/lib/media-pip.ts";
import "../../src/index.css";

function frame(label: string, start: string, end: string): string {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs><rect width="960" height="540" fill="url(#g)"/><circle cx="780" cy="120" r="180" fill="#ffffff" fill-opacity=".12"/><rect x="64" y="72" width="210" height="10" rx="5" fill="#ffffff" fill-opacity=".5"/><rect x="64" y="108" width="420" height="24" rx="12" fill="#ffffff" fill-opacity=".9"/><rect x="64" y="164" width="310" height="12" rx="6" fill="#ffffff" fill-opacity=".42"/><text x="64" y="430" fill="#ffffff" font-family="Inter, sans-serif" font-size="42" font-weight="700">${label}</text><text x="64" y="474" fill="#ffffff" fill-opacity=".7" font-family="Inter, sans-serif" font-size="20">Live media source</text></svg>`)}`;
}

const SOURCES: Record<
	"browser" | "desktop" | "recording",
	{
		end: string;
		kind: MediaSourceKind;
		start: string;
		title: string;
	}
> = {
	browser: {
		end: "#2563eb",
		kind: "browser",
		start: "#0f172a",
		title: "Agent Browser active tab",
	},
	desktop: {
		end: "#0f766e",
		kind: "desktop",
		start: "#164e63",
		title: "Remote node desktop",
	},
	recording: {
		end: "#c2410c",
		kind: "recording",
		start: "#7c2d12",
		title: "Evidence recording",
	},
};

function Proof() {
	const [active, setActive] = useState<keyof typeof SOURCES>("browser");
	const source = SOURCES[active];

	useEffect(() => {
		publishMediaSource({
			id: `proof:${active}`,
			imageUrl: frame(source.title, source.start, source.end),
			kind: source.kind,
			title: source.title,
			...(source.kind === "recording"
				? { videoUrl: "data:video/mp4;base64,proof" }
				: {}),
		});
		return () => clearMediaSource(`proof:${active}`);
	}, [active, source]);

	return (
		<main className="min-h-screen bg-[#09111f] px-6 py-10 text-white sm:px-10">
			<div className="mx-auto max-w-5xl space-y-8">
				<header className="max-w-2xl space-y-3">
					<p className="font-semibold text-cyan-300 text-xs uppercase tracking-[0.22em]">
						Live media proof
					</p>
					<h1 className="font-semibold text-4xl tracking-tight">
						One picture-in-picture surface for every active tab
					</h1>
					<p className="text-slate-300 text-sm leading-6">
						Browser frames, remote-node VNC frames, and evidence recordings
						share the same dock. Selecting the thumbnail opens the existing
						morphing lightbox.
					</p>
				</header>

				<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
					<div className="flex flex-wrap items-center justify-between gap-4">
						<div>
							<p className="font-medium text-lg">Active source</p>
							<p
								className="mt-1 text-slate-400 text-sm"
								data-testid="proof-active-source"
							>
								{source.title}
							</p>
						</div>
						<div
							aria-label="Choose media source"
							className="flex flex-wrap gap-2"
							role="group"
						>
							{(Object.keys(SOURCES) as Array<keyof typeof SOURCES>).map(
								(key) => (
									<button
										className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${active === key ? "border-cyan-300 bg-cyan-300/15 text-cyan-100" : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"}`}
										data-testid={`source-${key}`}
										key={key}
										onClick={() => setActive(key)}
										type="button"
									>
										{key}
									</button>
								)
							)}
						</div>
					</div>
					<div className="mt-6 grid min-h-[280px] place-items-center rounded-2xl border border-white/10 bg-black/20 p-8 text-center">
						<div className="max-w-md space-y-2">
							<p className="font-medium text-xl">Use the floating dock</p>
							<p className="text-slate-400 text-sm leading-6">
								The native OS PiP action appears in the bottom-right corner when
								a live source is active. Click its frame to test the
								small-to-large lightbox transition.
							</p>
						</div>
					</div>
				</section>
			</div>
			<MediaPipDock />
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Proof />);
}
