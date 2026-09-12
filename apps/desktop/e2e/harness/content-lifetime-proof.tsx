import { Button } from "@ryu/ui/components/button.tsx";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ContentScriptContext } from "wxt/utils/content-script-context";
import content from "../../../extension/entrypoints/content.ts";
import {
	askPage,
	release,
	resolveAsk,
	settingsChanged,
} from "./content-lifetime-browser.ts";
import "../../src/index.css";
let context: ContentScriptContext | undefined;
function start() {
	context?.notifyInvalidated();
	context = new ContentScriptContext("content-lifetime-proof");
	void content.main(context);
}
function App() {
	useEffect(() => {
		start();
		return () => context?.notifyInvalidated();
	}, []);
	return (
		<>
			<nav className="flex flex-wrap gap-2 p-6">
				<Button onClick={() => context?.notifyInvalidated()}>
					Invalidate script
				</Button>
				<Button onClick={start}>Restart script</Button>
				<Button onClick={release}>Release settings</Button>
				<Button onClick={settingsChanged}>Settings event</Button>
				<Button onClick={askPage}>Ask page</Button>
				<Button onClick={resolveAsk}>Resolve answer</Button>
			</nav>
			<main className="p-8">
				<h1 className="mb-4 font-semibold text-2xl">Browser workspace</h1>
				<p>
					A page whose context is shared only with the enabled browser features.
				</p>
				<textarea
					className="mt-6 min-h-24 w-full rounded-lg border p-3"
					placeholder="Write a prompt"
				/>
			</main>
		</>
	);
}
createRoot(document.getElementById("root")!).render(<App />);
