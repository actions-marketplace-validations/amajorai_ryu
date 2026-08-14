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

/**
 * Hard ceiling on how long the bridge may linger after its terminal frame.
 *
 * Core reads this pipe in a tight loop, so a flush costs milliseconds — the
 * 200 KB `done` frame measured 36 ms end to end. Two seconds is therefore far
 * more headroom than a flush needs, while keeping the OAuth callback port held
 * for no longer than Core already waits for the bridge's exit status
 * (`EXIT_STATUS_WAIT` in oauth_login.rs).
 */
const EXIT_GRACE_MS = 2000;

/**
 * Exit, giving stdout a chance to go out first.
 *
 * `process.exit()` DISCARDS anything still queued on a piped stdout, and every
 * terminal frame this bridge writes is the one frame that matters: drop the
 * `done` line and Core sees only EOF, which it can report as nothing better
 * than "the login flow exited before completing" — for a login that in fact
 * succeeded. The `done` frame is also the biggest thing written here (it
 * carries the whole credential), so it is the one most likely to still be in
 * the pipe when the process leaves.
 *
 * What this does NOT do is wait for a `drain` event. That was the previous
 * shape and it was dead code for most partially-buffered writes: Node arms
 * `drain` only when a `write()` returned `false`, i.e. only once the buffer
 * reached the high-water mark, which for a piped stdout is 65536. Measured
 * here — four 30001-byte writes to a pipe with a slow reader — the last write
 * still returned `true` with `writableLength = 30001`, the buffer emptied, and
 * `drain` never fired. So the "NOT optional" exit silently degraded to whatever
 * the event loop did next.
 *
 * The exit really is not optional: these flows bind fixed callback ports (53692
 * for Claude, 1455 for ChatGPT), and pi-ai closes its callback server with
 * `server.close()`, which does not destroy live keep-alive sockets — so the
 * loop can stay alive holding the port. Hence: set the code, let the loop wind
 * down on its own when nothing holds it, and arm an UNREF'd timer as the
 * ceiling. Unref'd is the point — it never keeps the process alive itself, it
 * only fires when something else already has.
 *
 * The old fast path (`writableLength === 0` -> exit at once) is gone with it.
 * On macOS a piped stdout is written asynchronously and `writableLength` drops
 * to 0 the moment libuv takes the chunk, NOT when the reader has it, so that
 * test never proved what it was asked to prove. Dropping it trades an instant
 * exit for at most {@link EXIT_GRACE_MS}, and only when something is holding
 * the loop open; a truncated `done` frame costs the user a successful login
 * reported as a failure, which is the worse of the two by a wide margin.
 */
const exitWhenFlushed = (code) => {
	rl.close();
	process.exitCode = code;
	setTimeout(() => process.exit(code), EXIT_GRACE_MS).unref();
};

async function main() {
	const providerId = process.argv[2];
	if (!providerId) {
		emit({ type: "error", message: "no provider id given" });
		return 2;
	}
	const provider = builtinProviders().find(
		(entry) => entry.id === providerId && entry.auth?.oauth !== undefined
	);
	if (!provider) {
		emit({
			type: "error",
			message: `provider "${providerId}" has no OAuth login in this pi-ai build`,
		});
		return 2;
	}
	const credential = await provider.auth.oauth.login({ prompt, notify });
	emit({ type: "done", credential });
	return 0;
}

main()
	.then((code) => exitWhenFlushed(code))
	.catch((error) => {
		emit({ type: "error", message: error?.message ?? String(error) });
		exitWhenFlushed(1);
	});
