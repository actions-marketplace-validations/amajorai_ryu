import { Button } from "@ryu/ui/components/button.tsx";
import { useViewClock } from "@ryu/ui/hooks/use-view-clock.ts";
import { isViewVisible } from "@ryu/ui/lib/view-visibility.ts";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App as Warmup } from "../../../../apps-store/warmup/ui/src/App.tsx";
import "../../src/index.css";
let reads = 0;
function result<T>(value: T): Promise<T> {
	reads++;
	parent.postMessage({ kind: "proof-read", reads }, "*");
	return Promise.resolve(value);
}
Object.assign(window, {
	ryu: {
		warmup: {
			detect: () =>
				result({
					tz: "UTC",
					agents: [
						{
							id: "sample",
							name: "Codex",
							available: true,
							plan: "Subscription",
							reason: null,
							models: [],
							windows: [
								{
									label: "Current window",
									usedPercent: 12,
									resetsAt: null,
									windowSeconds: 18_000,
								},
							],
						},
					],
				}),
			list: () => result([]),
		},
		catalog: { snapshot: () => result(null) },
	},
});
function Clocks() {
	const passive = useViewClock();
	const playback = useViewClock(1000, true);
	return (
		<div hidden>
			<output data-testid="passive-clock">{passive}</output>
			<output data-testid="playback-clock">{playback}</output>
		</div>
	);
}
function App() {
	const [mounted, setMounted] = useState(true);
	return (
		<main>
			<div className="px-6 pt-4">
				<Button onClick={() => setMounted(!mounted)}>
					{mounted ? "Close panels" : "Open panels"}
				</Button>
			</div>
			{mounted && (
				<>
					<Clocks />
					<Warmup />
				</>
			)}
		</main>
	);
}
window.addEventListener("message", (event) => {
	if (event.source === parent && event.data === "proof-visibility") {
		parent.postMessage(
			{
				kind: "proof-visibility",
				visible: isViewVisible(),
				documentVisibility: document.visibilityState,
			},
			"*"
		);
	}
});
createRoot(document.getElementById("root")!).render(<App />);
