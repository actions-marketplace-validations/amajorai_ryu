import { mergeConfig } from "vite";
import base from "../vite.config.ts";

// Full Desktop entry, with local-only networking for an isolated native proof.
export default mergeConfig(base, {
	plugins:
		process.env.RYU_NATIVE_SESSION_PROOF === "1"
			? [
					{
						name: "native-performance-session-setup",
						enforce: "pre" as const,
						transform(source: string, id: string) {
							if (
								process.env.RYU_NATIVE_REACT_PROFILE !== "1" ||
								!id.endsWith("/src/main.tsx")
							) {
								return;
							}
							const target = '<App hostSurface="desktop" />';
							if (!source.includes(target)) {
								throw new Error("Native profiler entry changed");
							}
							return source
								.replace(
									'import { StrictMode } from "react";',
									'import { StrictMode, Profiler } from "react";\nimport { recordNativeRender } from "/e2e/native-react-profile.ts";'
								)
								.replace(
									target,
									`<Profiler id="desktop" onRender={recordNativeRender}>${target}</Profiler>`
								);
						},
						transformIndexHtml() {
							return [
								{
									tag: "script",
									injectTo: "head-prepend" as const,
									children: `
   if (!localStorage.getItem("ryu:native-performance-seeded")) {
    localStorage.setItem("ryu_desktop_onboarding_complete","true");
    localStorage.setItem("ryu:product-mode","console");
    localStorage.setItem("ryu_startup_behavior","restore");
    localStorage.setItem("ryu_session_tabs",JSON.stringify({activeIndex:0,tabs:[{path:"/library",title:"Library"},{path:"/chat",title:"Performance draft"}]}));
    localStorage.setItem("ryu:native-performance-seeded","true");
   }
  `,
								},
							];
						},
					},
				]
			: [],
	define: { "import.meta.env.VITE_RYU_PRODUCT": JSON.stringify("build") },
	cacheDir: "/tmp/ryu-native-performance-vite-cache",
	server: {
		host: "127.0.0.1",
		port: 5225,
		strictPort: true,
		hmr: false,
		watch: null,
		headers: {
			"Content-Security-Policy":
				"connect-src 'self' ipc: http://ipc.localhost http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; frame-src 'self' about: blob: http://localhost:* http://127.0.0.1:*; img-src 'self' data: blob: http://localhost:* http://127.0.0.1:*",
		},
	},
});
