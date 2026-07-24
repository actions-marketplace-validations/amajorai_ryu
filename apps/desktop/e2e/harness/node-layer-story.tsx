// Standalone browser story for the REAL `NodeLayerMenu` — the submenu shell every
// layer of the node selector renders through (services, chat engine, the
// run-alongside engines, TTS + its nested voice picker, STT, sandbox backend).
//
// The component is purely prop-driven (it owns layout + pending state and nothing
// else), so the whole matrix is reachable without Core, Tauri, or seed data. This
// covers the three things static checks cannot: that a submenu opens at all, that
// the TTS → Voice picker is usable THREE levels deep, and that a layer with no
// actions and no options (a read-only running service) still renders its header
// instead of an empty popup.
//
// HARNESS LIMIT: like the other stories, this bare harness ships no Tailwind
// plugin, so utility classes are never generated. This asserts STRUCTURE and
// interaction, not visual styling.

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@ryu/ui/components/dropdown-menu";
import { createRoot } from "react-dom/client";
import {
	type LayerOption,
	NodeLayerMenu,
	startStopAction,
} from "../../src/components/shell/NodeLayerMenu.tsx";
import "../../src/index.css";

const noop = () => undefined;

const CHAT_INSTALLED: LayerOption[] = [
	{
		name: "llamacpp",
		label: "llama.cpp",
		active: true,
		detail: "b9670",
		select: noop,
	},
	{
		name: "ollama",
		label: "Ollama",
		detail: "0.5.1",
		select: noop,
		uninstall: noop,
	},
];

const CHAT_AVAILABLE: LayerOption[] = [
	{ name: "vllm", label: "vLLM", detail: "0.7.0", select: noop },
	{
		name: "sglang",
		label: "SGLang",
		disabled: true,
		disabledReason: "unsupported here",
		select: noop,
	},
];

const SPEECH_INSTALLED: LayerOption[] = [
	{
		name: "ryutts",
		label: "Ryu TTS",
		active: true,
		detail: "1.2 GB · 4%",
		select: noop,
		uninstall: noop,
	},
	{ name: "parakeet", label: "Parakeet v3", select: noop, uninstall: noop },
];

const VOICES: LayerOption[] = [
	{ name: "af_heart", label: "af_heart", active: true, select: noop },
	{ name: "am_puck", label: "am_puck", select: noop },
];

function Story() {
	return (
		<div style={{ padding: 40 }}>
			<DropdownMenu>
				<DropdownMenuTrigger>Node</DropdownMenuTrigger>
				{/* Same width the node selector uses, so the story's trigger rows are
				    laid out exactly as they are in the app. */}
				<DropdownMenuContent className="w-72">
					{/* Singleton service: actions only, no swap list. */}
					<NodeLayerMenu
						actions={[
							startStopAction(true, noop),
							{
								id: "update",
								label: "Update",
								tone: "warning",
								run: noop,
							},
						]}
						caption="Running · 2.1 GB · 4%"
						currentLabel="Core"
						label="Core"
						running={true}
						trailing="2.1 GB · 4%"
						version="0.0.9"
					/>
					{/* Read-only running service: header only, no body at all. */}
					<NodeLayerMenu
						caption="Running"
						currentLabel="Island"
						label="Island"
						running={true}
					/>
					{/* Swap layer: no start/stop, tick on the active engine. */}
					<NodeLayerMenu
						available={CHAT_AVAILABLE}
						caption="Resident chat engine · 2.1 GB"
						currentLabel="llama.cpp"
						installed={CHAT_INSTALLED}
						label="Chat engine"
						running={true}
						version="b9670"
					/>
					{/* Toggle layer: independent engines, tick means running. */}
					<NodeLayerMenu
						caption="1 of 2 running"
						currentLabel="Ryu TTS"
						installed={SPEECH_INSTALLED}
						label="Speech"
						running={true}
						selectionMode="toggle"
					/>
					{/* Nested second dimension: a Voice picker inside the TTS layer. */}
					<NodeLayerMenu
						caption="Speaks as af_heart"
						currentLabel="Kokoro"
						installed={[
							{
								name: "kokoro",
								label: "Kokoro",
								active: true,
								detail: "2 voices",
								select: noop,
							},
						]}
						label="Text-to-speech"
						running={true}
					>
						<NodeLayerMenu
							currentLabel="af_heart"
							installed={VOICES}
							label="Voice"
						/>
					</NodeLayerMenu>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
