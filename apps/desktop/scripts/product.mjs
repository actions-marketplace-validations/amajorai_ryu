import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const [command, product = "bot", ...args] = process.argv.slice(2);

if (command !== "build" && command !== "dev") {
	console.error(
		"Usage: node scripts/product.mjs <build|dev> <product> [...args]"
	);
	process.exit(2);
}

const config = product === "bot" ? "src-tauri/tauri.bot.conf.json" : null;
const commandArgs = config ? ["--config", config, ...args] : args;
const child = spawn(
	process.execPath,
	[fileURLToPath(new URL(`./${command}.mjs`, import.meta.url)), ...commandArgs],
	{
		env: { ...process.env, VITE_RYU_PRODUCT: product },
		stdio: "inherit",
		shell: process.platform === "win32",
	}
);

child.on("exit", (code) => process.exit(code ?? 1));
