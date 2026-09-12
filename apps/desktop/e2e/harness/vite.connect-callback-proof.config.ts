import path from "node:path";
import { mergeConfig } from "vite";
import base from "./vite.welcome.config.ts";

export default mergeConfig(base, {
	build: {
		outDir: path.resolve(
			import.meta.dirname,
			"../../../../tmp/ryu-connect-callback-proof"
		),
		rollupOptions: {
			input: path.resolve(import.meta.dirname, "connect-callback-proof.html"),
		},
	},
});
