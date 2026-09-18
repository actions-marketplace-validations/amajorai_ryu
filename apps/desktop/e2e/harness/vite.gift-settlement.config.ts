import { mergeConfig } from "vite";
import base from "./vite.harness.config.ts";
export default mergeConfig(base, {
	cacheDir: "/tmp/ryu-gift-settlement-cache",
	define: {
		"process.env": { NEXT_PUBLIC_SERVER_URL: "http://127.0.0.1:5239" },
	},
	optimizeDeps: { entries: ["gift-settlement-proof.html"] },
	server: { port: 5239, strictPort: true, watch: null, hmr: false },
});
