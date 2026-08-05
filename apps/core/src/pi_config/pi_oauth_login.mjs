// Ryu ↔ pi-ai OAuth login bridge.
//
// Drives ONE subscription login (`anthropic` / `openai-codex` / `github-copilot`
// / …) using pi-ai's own flow modules, and speaks JSONL over stdio so Core can
// surface the flow in the desktop instead of a terminal nobody can see.
//
// Why a Node helper rather than three OAuth flows reimplemented in Rust: pi-ai
// already ships and maintains them (`dist/auth/oauth/*.js`), including Copilot's
// bespoke GitHub-device → Copilot-token exchange that `OAUTH_PROVIDERS` in
// pi_config deliberately refuses to guess at. Bridging the vendor flow keeps the
// client ids and endpoints out of Ryu entirely.
//
// This file is `include_str!`-embedded in Core and written into the managed Pi
// prefix (`~/.ryu/pi`) at runtime, so `@earendil-works/pi-ai` resolves from that
// tree's `node_modules`.
//
// Protocol — one JSON object per line.
//   stdout: {type:"auth_url", url, instructions?}
//           {type:"device_code", verificationUri, userCode}
//           {type:"progress"|"info", message}
//           {type:"prompt", id, prompt:{type, message, placeholder?, options?}}
//           {type:"done", credential:{…}}
//           {type:"error", message}
//   stdin:  {id, value}     — the answer to a "prompt" event
//
// It deliberately does NOT write auth.json. The CLI this mirrors
// (`pi-ai/dist/cli.js`) writes a CWD-relative "auth.json", which would land the
// credential wherever Core happened to be started from. Core receives the
// credential on the "done" event and merges it into the managed Pi's auth.json
// itself, with the 0600 handling that file already gets.

import { createInterface } from "node:readline";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

/** Emit one event. Every write is a single line — Core parses line-by-line. */
const emit = (event) => {
	process.stdout.write(`${JSON.stringify(event)}\n`);
};

// Answers arrive asynchronously; each pending prompt parks here until its id
// comes back. Keyed by id so a flow that prompts twice cannot cross its answers.
const pending = new Map();
let nextPromptId = 0;

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
	const trimmed = line.trim();
	if (!trimmed) {
		return;
	}
	let message;
	try {
		message = JSON.parse(trimmed);
	} catch {
		return;
	}
	const resolve = pending.get(message.id);
	if (resolve) {
		pending.delete(message.id);
		resolve(String(message.value ?? ""));
	}
});

/**
 * Ask Core for a value. The prompt object is forwarded VERBATIM — `options` in
 * particular must survive, because Copilot's flow asks a `select` and expects
 * one of the option ids back, not free text or an index.
 */
const prompt = (authPrompt) => {
	const id = `p${nextPromptId++}`;
	return new Promise((resolve) => {
		pending.set(id, resolve);
		emit({ type: "prompt", id, prompt: authPrompt });
	});
};

const notify = (event) => {
	switch (event.type) {
		case "auth_url":
			emit({
				type: "auth_url",
				url: event.url,
				instructions: event.instructions,
			});
			break;
		case "device_code":
			emit({
				type: "device_code",
				verificationUri: event.verificationUri,
				userCode: event.userCode,
			});
			break;
		case "info":
		case "progress":
			emit({ type: event.type, message: event.message });
			break;
		default:
			break;
	}
};

async function main() {
	const providerId = process.argv[2];
	if (!providerId) {
		emit({ type: "error", message: "no provider id given" });
		process.exit(2);
	}
	const provider = builtinProviders().find(
		(entry) => entry.id === providerId && entry.auth?.oauth !== undefined
	);
	if (!provider) {
		emit({
			type: "error",
			message: `provider "${providerId}" has no OAuth login in this pi-ai build`,
		});
		process.exit(2);
	}
	const credential = await provider.auth.oauth.login({ prompt, notify });
	emit({ type: "done", credential });
}

main()
	.then(() => {
		rl.close();
		process.exit(0);
	})
	.catch((error) => {
		emit({ type: "error", message: error?.message ?? String(error) });
		rl.close();
		process.exit(1);
	});
