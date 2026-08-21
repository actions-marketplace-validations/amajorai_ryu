import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
	readBotTerminology,
	setBotTerminology,
} from "@ryu/ui/hooks/use-bot-terminology.ts";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { setInterfaceLevel } from "@/src/lib/interface-level.ts";
import { BotTerminologyProvider } from "./BotTerminologyProvider.tsx";

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register();
}

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("BotTerminologyProvider", () => {
	let container: HTMLDivElement;
	let root: ReturnType<typeof createRoot>;

	beforeEach(() => {
		localStorage.clear();
		setInterfaceLevel("expert", { applyPrefs: false });
		setBotTerminology(true);
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

	it("rewrites UI text and accessible labels without touching authored content", async () => {
		await act(async () => {
			root.render(
				createElement(
					BotTerminologyProvider,
					null,
					createElement(
						"div",
						null,
						createElement("button", { title: "Agent agents" }, "Agent Agents"),
						createElement("input", {
							"aria-label": "Agents",
							placeholder: "agent",
						}),
						createElement(
							"div",
							{ "data-slot": "message-content" },
							"Agent agents"
						),
						createElement("pre", null, "Agent agents")
					)
				)
			);
		});

		expect(container.querySelector("button")?.textContent).toBe("Bot Bots");
		expect(container.querySelector("button")?.title).toBe("Bot bots");
		expect(container.querySelector("input")?.getAttribute("aria-label")).toBe(
			"Bots"
		);
		expect(container.querySelector("input")?.placeholder).toBe("bot");
		expect(
			container.querySelector('[data-slot="message-content"]')?.textContent
		).toBe("Agent agents");
		expect(container.querySelector("pre")?.textContent).toBe("Agent agents");
	});

	it("restores the original UI when the setting is turned off", async () => {
		await act(async () => {
			root.render(
				createElement(
					BotTerminologyProvider,
					null,
					createElement("button", { title: "Agent" }, "Agents")
				)
			);
		});

		expect(container.textContent).toBe("Bots");
		await act(async () => {
			setBotTerminology(false);
			await Promise.resolve();
		});

		expect(readBotTerminology()).toBe(false);
		expect(container.textContent).toBe("Agents");
		expect(container.querySelector("button")?.title).toBe("Agent");
	});
});
