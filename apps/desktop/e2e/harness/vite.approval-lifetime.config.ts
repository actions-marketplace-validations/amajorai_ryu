import path from "node:path";
import { mergeConfig } from "vite";
import base from "./vite.harness.config.ts";

const config = mergeConfig(base, {
	cacheDir: "/tmp/ryu-approval-lifetime-cache",
	optimizeDeps: { entries: ["approval-lifetime-proof.html"] },
	server: { port: 5237, strictPort: true, watch: null, hmr: false },
});

config.resolve = {
	...config.resolve,
	alias: [
		{
			find: "@/lib/auth-client.ts",
			replacement: path.resolve(
				import.meta.dirname,
				"approval-session-fixture.ts"
			),
		},
		{ find: "@", replacement: path.resolve(import.meta.dirname, "../..") },
	],
};
export default config;
