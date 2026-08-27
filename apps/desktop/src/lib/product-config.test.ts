import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type JsonObject = Record<string, unknown>;

const desktopRoot = join(import.meta.dir, "../..");

function readJson(path: string): JsonObject {
	return JSON.parse(
		readFileSync(join(desktopRoot, path), "utf8")
	) as JsonObject;
}

function firstWindow(config: JsonObject): JsonObject {
	const app = config.app as JsonObject;
	const windows = app.windows as JsonObject[];
	return windows[0] as JsonObject;
}

describe("Ryu Bot desktop product config", () => {
	test("keeps the shared native window settings while changing product identity", () => {
		const buildWindow = firstWindow(readJson("src-tauri/tauri.conf.json"));
		const botConfig = readJson("src-tauri/tauri.bot.conf.json");
		const botWindow = firstWindow(botConfig);
		const sharedWindowKeys = [
			"width",
			"height",
			"minWidth",
			"minHeight",
			"center",
			"resizable",
			"decorations",
			"transparent",
			"shadow",
			"dragDropEnabled",
			"zoomHotkeysEnabled",
			"additionalBrowserArgs",
		];

		for (const key of sharedWindowKeys) {
			expect(botWindow[key]).toBe(buildWindow[key]);
		}
		expect(botWindow.title).toBe("Ryu Bot");
		expect(botConfig.productName).toBe("Ryu Bot");
		expect(botConfig.mainBinaryName).toBe("Ryu Bot");
		expect(botConfig.identifier).toBe("ai.amajor.ryu.bot");
		const updater = (botConfig.plugins as JsonObject).updater as JsonObject;
		expect(updater.endpoints).toEqual([
			"https://github.com/amajorai/ryu/releases/latest/download/latest-bot.json",
		]);
		expect(typeof updater.pubkey).toBe("string");
	});
});
