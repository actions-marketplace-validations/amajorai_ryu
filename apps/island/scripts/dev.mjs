// Island dev entry: default RYU_PROFILE=dev so a dev island binds the shifted
// control port (:8989), brands as "Ryu Island Dev", and dials the dev Core
// (:8980) instead of a release stack. Explicit wins — RYU_PROFILE=release
// restores the old behaviour. Mirrors scripts/dev-stack.mjs (root) and
// apps/core/scripts/dev.js.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

if (!(process.env.RYU_PROFILE ?? "").trim()) {
	process.env.RYU_PROFILE = "dev";
}

if (!process.env.ELECTRON_EXEC_PATH) {
	const require = createRequire(import.meta.url);
	const electronPackage = dirname(require.resolve("electron/package.json"));
	const executable =
		process.platform === "darwin"
			? join(electronPackage, "dist/Electron.app/Contents/MacOS/Electron")
			: join(electronPackage, "dist/electron");
	if (existsSync(executable)) {
		process.env.ELECTRON_EXEC_PATH = executable;
	}
}

const child = spawn("electron-vite", ["dev", ...process.argv.slice(2)], {
	stdio: "inherit",
	shell: process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 0));
