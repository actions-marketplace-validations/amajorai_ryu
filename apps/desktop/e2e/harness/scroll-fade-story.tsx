import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

interface Metrics {
	animationName: string;
	animationTimeline: string;
	bottomFade: string;
	clientHeight: number;
	maskImage: string;
	scrollHeight: number;
	topFade: string;
}

const ROWS = Array.from({ length: 18 }, (_, index) => index + 1);

function readMetrics(element: HTMLDivElement): Metrics {
	const styles = getComputedStyle(element);
	return {
		animationName: styles.animationName,
		animationTimeline: styles.getPropertyValue("animation-timeline").trim(),
		bottomFade: styles.getPropertyValue("--scroll-fade-b").trim(),
		maskImage: styles.maskImage,
		scrollHeight: element.scrollHeight,
		clientHeight: element.clientHeight,
		topFade: styles.getPropertyValue("--scroll-fade-t").trim(),
	};
}

function ScrollFadeStory() {
	const scrollerRef = useRef<HTMLDivElement>(null);
	const [metrics, setMetrics] = useState<Metrics | null>(null);
	const [scrollTop, setScrollTop] = useState(0);

	useEffect(() => {
		const element = scrollerRef.current;
		if (!element) {
			return;
		}

		const update = () => {
			setMetrics(readMetrics(element));
			setScrollTop(element.scrollTop);
		};
		update();
		element.addEventListener("scroll", update, { passive: true });
		return () => element.removeEventListener("scroll", update);
	}, []);

	const hasShadcnMask =
		metrics?.maskImage.includes("linear-gradient") === true &&
		metrics.animationName.includes("scroll-fade-reveal") &&
		metrics.animationTimeline.includes("scroll");
	const hasOverflow =
		metrics !== null && metrics.scrollHeight > metrics.clientHeight;
	const verified = hasShadcnMask && hasOverflow && scrollTop > 0;

	return (
		<main className="min-h-screen bg-background p-6 text-foreground">
			<div className="mx-auto flex max-w-2xl flex-col gap-4">
				<header className="flex items-start justify-between gap-4">
					<div>
						<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
							React verification artifact
						</p>
						<h1 className="font-semibold text-2xl">Shadcn scroll fade</h1>
						<p className="mt-1 text-muted-foreground text-sm">
							The shared utility fades the scroll edges with a CSS scroll
							timeline.
						</p>
					</div>
					<p
						className="rounded-full border px-3 py-1 font-medium text-xs"
						data-status={verified ? "pass" : "pending"}
						data-testid="proof-status"
					>
						{verified ? "PASS" : "SCROLL TO VERIFY"}
					</p>
				</header>

				<section className="overflow-hidden rounded-xl border bg-card shadow-sm">
					<div
						className="scroll-fade h-72 overflow-y-auto p-4"
						data-testid="scroll-fade-scroller"
						ref={scrollerRef}
					>
						<ol className="flex flex-col gap-3">
							{ROWS.map((row) => (
								<li className="rounded-lg border bg-background p-4" key={row}>
									<p className="font-medium text-sm">Scrollable item {row}</p>
									<p className="mt-1 text-muted-foreground text-sm">
										The edge mask stays attached to this native scroll
										container.
									</p>
								</li>
							))}
						</ol>
					</div>
				</section>

				<dl className="grid gap-2 rounded-xl border bg-card p-4 text-sm sm:grid-cols-2">
					<div>
						<dt className="text-muted-foreground">Utility</dt>
						<dd className="font-mono">scroll-fade</dd>
					</div>
					<div>
						<dt className="text-muted-foreground">Scroll timeline</dt>
						<dd className="font-mono" data-testid="timeline-value">
							{metrics?.animationTimeline || "pending"}
						</dd>
					</div>
					<div>
						<dt className="text-muted-foreground">Mask</dt>
						<dd className="font-mono" data-testid="mask-value">
							{metrics?.maskImage || "pending"}
						</dd>
					</div>
					<div>
						<dt className="text-muted-foreground">Scroll position</dt>
						<dd className="font-mono" data-testid="scroll-position">
							{Math.round(scrollTop)}px
						</dd>
					</div>
				</dl>
			</div>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<ScrollFadeStory />);
}
