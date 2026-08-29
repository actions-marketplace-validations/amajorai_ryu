import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tauriCli = require.resolve("@tauri-apps/cli/tauri.js");

const buildArguments = ["build", ...process.argv.slice(2)];

// CI and the local release publisher provide the updater signing key. Ordinary
// workspace builds should still produce installable application bundles without
// attempting the signed updater artifacts that require that secret.
if (!(process.env.TAURI_SIGNING_PRIVATE_KEY ?? "").trim()) {
	buildArguments.push(
		"--config",
		JSON.stringify({ bundle: { createUpdaterArtifacts: false } })
	);
}

const child = spawn(process.execPath, [tauriCli, ...buildArguments], {
	stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 1));
