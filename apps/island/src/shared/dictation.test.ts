import { describe, expect, it } from "bun:test";
import {
	EMPTY_AGENT_SELECTION,
	isAgentSelectionEmpty,
	parseAgentSelection,
	parseAgentSelectionWithLegacyAgent,
} from "./agent-selection.ts";
import {
	DEFAULT_DICTATION_ASK,
	DEFAULT_DICTATION_ASK_PROMPT,
	DEFAULT_DICTATION_ASK_SHORTCUT,
	DEFAULT_DICTATION_POSTPROCESS_PROMPT,
	DEFAULT_DICTATION_PREFS,
	DEFAULT_DICTATION_SHORTCUT,
	parseDictationPrefs,
} from "./dictation.ts";

describe("parseAgentSelection", () => {
	it("returns empty for null/garbage", () => {
		expect(parseAgentSelection(null)).toEqual(EMPTY_AGENT_SELECTION);
		expect(parseAgentSelection(undefined)).toEqual(EMPTY_AGENT_SELECTION);
		expect(isAgentSelectionEmpty(EMPTY_AGENT_SELECTION)).toBe(true);
	});

	it("parses a full selection object", () => {
		const sel = parseAgentSelection({
			agent_id: "ryu",
			model: "",
			provider: "",
			effort: "high",
			thinking_level: "",
			access_mode: "acceptEdits",
		});
		expect(sel.agent_id).toBe("ryu");
		expect(sel.effort).toBe("high");
		expect(sel.access_mode).toBe("acceptEdits");
		expect(isAgentSelectionEmpty(sel)).toBe(false);
	});

	it("legacy agent string fills agent_id when selection empty", () => {
		expect(parseAgentSelectionWithLegacyAgent(null, "coder")).toEqual({
			...EMPTY_AGENT_SELECTION,
			agent_id: "coder",
		});
		expect(
			parseAgentSelectionWithLegacyAgent({ agent_id: "ryu" }, "coder").agent_id
		).toBe("ryu");
	});
});

describe("parseDictationPrefs", () => {
	it("returns the default for null/empty/malformed input", () => {
		expect(parseDictationPrefs(null)).toEqual(DEFAULT_DICTATION_PREFS);
		expect(parseDictationPrefs("")).toEqual(DEFAULT_DICTATION_PREFS);
		expect(parseDictationPrefs("{bad")).toEqual(DEFAULT_DICTATION_PREFS);
	});

	it("parses selection-based postProcess and ask", () => {
		const prefs = parseDictationPrefs(
			JSON.stringify({
				ask: {
					enabled: true,
					mode: "toggle",
					prompt: "Answer.",
					shortcut: "Alt+A",
					selection: {
						agent_id: "ryu",
						model: "",
						provider: "",
						effort: "",
						thinking_level: "",
						access_mode: "",
					},
				},
				autoSend: true,
				enabled: false,
				engine: "whisper",
				insertMode: "paste",
				mode: "toggle",
				pasteKeys: "cmd+shift+v",
				postProcess: {
					enabled: true,
					prompt: "Fix it.",
					selection: {
						agent_id: "",
						model: "gemma-4",
						provider: "local",
						effort: "",
						thinking_level: "",
						access_mode: "",
					},
				},
				restoreClipboard: false,
				shortcut: "Alt+D",
			})
		);
		expect(prefs.postProcess.selection.model).toBe("gemma-4");
		expect(prefs.ask.selection.agent_id).toBe("ryu");
		expect(prefs.ask.shortcut).toBe("Alt+A");
		expect(prefs.enabled).toBe(false);
	});

	it("migrates legacy agent string on postProcess/ask", () => {
		const prefs = parseDictationPrefs(
			JSON.stringify({
				postProcess: { agent: "coder", enabled: true, prompt: "Tidy." },
				ask: { agent: "ryu", enabled: true },
			})
		);
		expect(prefs.postProcess.selection.agent_id).toBe("coder");
		expect(prefs.postProcess.enabled).toBe(true);
		expect(prefs.postProcess.prompt).toBe("Tidy.");
		expect(prefs.ask.selection.agent_id).toBe("ryu");
		expect(prefs.ask.enabled).toBe(true);
	});

	it("uses opinionated defaults", () => {
		const prefs = parseDictationPrefs(JSON.stringify({}));
		expect(prefs.mode).toBe("push-to-talk");
		expect(prefs.engine).toBe("parakeet");
		expect(prefs.insertMode).toBe("type");
		expect(prefs.enabled).toBe(true);
		expect(prefs.shortcut).toBe(DEFAULT_DICTATION_SHORTCUT);
		expect(prefs.ask).toEqual(DEFAULT_DICTATION_ASK);
		expect(prefs.postProcess).toEqual({
			enabled: false,
			prompt: DEFAULT_DICTATION_POSTPROCESS_PROMPT,
			selection: EMPTY_AGENT_SELECTION,
		});
		expect(prefs.ask.prompt).toBe(DEFAULT_DICTATION_ASK_PROMPT);
		expect(prefs.ask.shortcut).toBe(DEFAULT_DICTATION_ASK_SHORTCUT);
	});
});
