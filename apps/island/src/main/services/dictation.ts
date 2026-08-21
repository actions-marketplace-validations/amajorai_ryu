// Main-process dictation pipeline: turn captured audio into text typed straight
// into whatever native app has OS focus (WhisprFlow / SuperWhisper style), or
// run an agent on the spoken question and paste the answer (agent-ask mode).
//
// Owned by the `dictation` apps-store app; Island is the OS surface. Stages:
//   1. transcribe  — Core `/api/voice/transcribe` with the configured engine.
//   2. task branch:
//        - transcribe → optional LLM cleanup (postProcess selection), then insert
//        - ask        → run agent/model from ask.selection, insert the answer
//   3. insert       — type (ghost `ghost_type`) or paste (clipboard + paste chord).
//
// Selection resolve: non-empty agent_id → runAgentText (agent tools/Spaces apply);
// otherwise → completions with optional model id (fast local default when blank).

import { clipboard } from "electron";
import type { AgentSelection } from "../../shared/agent-selection.ts";
import { DEFAULT_AGENT_ID } from "../../shared/agents.ts";
import {
	type DictationPrefs,
	type DictationTask,
	parseDictationPrefs,
} from "../../shared/dictation.ts";
import type {
	CoreChatMessage,
	DictationSubmitResult,
} from "../../shared/ipc.ts";
import { callTool, completions, runAgentText, transcribe } from "./core.ts";

/**
 * Delay before restoring the pre-paste clipboard. The paste chord is dispatched
 * asynchronously through the OS, so restoring too early races the paste.
 */
const CLIPBOARD_RESTORE_DELAY_MS = 400;

/** The `ryu` agent gates the ghost MCP calls; its allowlist is unrestricted. */
const GHOST_AGENT_ID = DEFAULT_AGENT_ID;

/** Resolve the paste chord into ghost `keys` tokens, platform-defaulting when unset. */
function pasteKeysFor(prefs: DictationPrefs): string[] {
	const custom = prefs.pasteKeys
		.split("+")
		.map((token) => token.trim().toLowerCase())
		.filter((token) => token.length > 0);
	if (custom.length > 0) {
		return custom;
	}
	return process.platform === "darwin" ? ["cmd", "v"] : ["ctrl", "v"];
}

/**
 * Run a standard AgentSelection: agent_id → full agent turn (tools/Spaces from
 * that agent); otherwise a one-shot completion with optional model id.
 */
async function runSelection(
	selection: AgentSelection,
	systemPrompt: string,
	userText: string
): Promise<string | null> {
	const messages: CoreChatMessage[] = [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: userText },
	];
	const agentId = selection.agent_id.trim();
	const result =
		agentId.length > 0
			? await runAgentText(agentId, messages)
			: await completions({
					messages,
					model: selection.model.trim() || undefined,
				});
	if (!result.available) {
		return null;
	}
	const text = result.text.trim();
	return text.length > 0 ? text : null;
}

/**
 * Optionally clean the raw transcript with the postProcess selection. Fails open
 * to the raw transcript when disabled or when the model/agent returns nothing.
 */
async function postProcess(
	text: string,
	prefs: DictationPrefs
): Promise<string> {
	if (!prefs.postProcess.enabled) {
		return text;
	}
	// Empty selection = fast local default model (omit model id).
	const cleaned = await runSelection(
		prefs.postProcess.selection,
		prefs.postProcess.prompt,
		text
	);
	return cleaned ?? text;
}

/**
 * Run ask-mode: selection must produce an answer. Fails closed to empty when
 * unavailable — agent-ask should not silently paste the raw question.
 */
async function runAsk(
	question: string,
	prefs: DictationPrefs
): Promise<string | null> {
	return runSelection(prefs.ask.selection, prefs.ask.prompt, question);
}

/** Insert `text` into the focused app per the configured insertion mode. */
async function insertText(text: string, prefs: DictationPrefs): Promise<void> {
	if (prefs.insertMode === "paste") {
		const previous = prefs.restoreClipboard ? clipboard.readText() : null;
		clipboard.writeText(text);
		await callTool({
			agent_id: GHOST_AGENT_ID,
			arguments: { keys: pasteKeysFor(prefs) },
			tool: "ghost.ghost_hotkey",
		});
		if (previous !== null) {
			setTimeout(() => {
				clipboard.writeText(previous);
			}, CLIPBOARD_RESTORE_DELAY_MS);
		}
	} else {
		await callTool({
			agent_id: GHOST_AGENT_ID,
			arguments: { text },
			tool: "ghost.ghost_type",
		});
	}
	if (prefs.autoSend) {
		await callTool({
			agent_id: GHOST_AGENT_ID,
			arguments: { key: "enter" },
			tool: "ghost.ghost_press",
		});
	}
}

/**
 * Run the full dictation pipeline on captured WAV bytes. `task` selects
 * transcribe (insert transcript) vs ask (insert agent answer). Never rejects.
 */
export async function runDictation(
	audio: ArrayBuffer,
	rawPrefs: string | null,
	task: DictationTask = "transcribe"
): Promise<DictationSubmitResult> {
	const prefs = parseDictationPrefs(rawPrefs);
	if (!prefs.enabled) {
		return { ok: false, reason: "disabled" };
	}
	const transcript = await transcribe(audio, prefs.engine);
	if (!transcript.available) {
		return { ok: false, reason: transcript.reason };
	}
	const raw = transcript.text.trim();
	if (raw.length === 0) {
		return { ok: false, reason: "empty" };
	}

	let finalText: string;
	if (task === "ask") {
		if (!prefs.ask.enabled) {
			return { ok: false, reason: "ask-disabled" };
		}
		const answer = await runAsk(raw, prefs);
		if (!answer) {
			return { ok: false, reason: "ask-failed" };
		}
		finalText = answer;
	} else {
		finalText = (await postProcess(raw, prefs)).trim();
		if (finalText.length === 0) {
			return { ok: false, reason: "empty" };
		}
	}

	try {
		await insertText(finalText, prefs);
	} catch (error) {
		return {
			ok: false,
			reason: error instanceof Error ? error.message : "insert-failed",
		};
	}
	return { ok: true, text: finalText };
}
