import { mergeConfig } from "vite";
import base from "./vite.harness.config.ts";
export default mergeConfig(base, {
	cacheDir: "/tmp/ryu-subscription-visibility-cache",
	optimizeDeps: { entries: ["subscription-visibility-proof.html"] },
	server: { port: 5219, strictPort: true, watch: null, hmr: false },
});
