import { mergeConfig } from "vite";
import base from "./vite.harness.config.ts";
export default mergeConfig(base, {
	cacheDir: "/tmp/ryu-dom-localizer-cache",
	optimizeDeps: { entries: ["dom-localizer-proof.html"] },
	server: { port: 5240, strictPort: true, watch: null, hmr: false },
});
