import path from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { assessment, doctor } from "./health-audit-fixtures.ts";

const harnessDir = path.resolve(import.meta.dirname);
const desktopRoot = path.resolve(harnessDir, "../..");

/** Isolated build for the catalog scan proof; unrelated stories stay out of its graph. */
export default defineConfig({
	plugins: [
		react(),
		{
			name: "audit-fixture-transport",
			configureServer(server) {
				server.middlewares.use(async (req, res, next) => {
					if (!req.url?.startsWith("/api/")) {
						return next();
					}
					res.setHeader("content-type", "application/json");
					if (req.url.startsWith("/api/preferences/")) {
						res.end(
							JSON.stringify({
								value: [
									"/api/preferences/claude-gateway-routing",
									"/api/preferences/codex-gateway-routing",
								].includes(req.url)
									? "false"
									: null,
							})
						);
						return;
					}
					if (req.url === "/api/gateway/config") {
						res.end(
							JSON.stringify({
								firewall: {
									enabled: true,
									scan_inbound: true,
									scan_outbound: true,
									redact_pii: true,
									redact_secrets: true,
									wrap_untrusted_tool_results: true,
								},
							})
						);
						return;
					}
					if (req.url === "/api/gateway/doctor") {
						res.end(JSON.stringify(doctor));
						return;
					}
					if (req.url === "/api/catalog/scan" && req.method === "POST") {
						const chunks = [];
						for await (const chunk of req) {
							chunks.push(chunk);
						}
						const body = Buffer.concat(chunks).toString();
						const input = JSON.parse(body);
						if (process.env.RYU_AUDIT_PROOF_CORE) {
							const response = await fetch(
								`${process.env.RYU_AUDIT_PROOF_CORE}/api/catalog/scan`,
								{
									method: "POST",
									headers: {
										authorization: "Bearer audit-proof",
										"content-type": "application/json",
									},
									body,
								}
							);
							res.statusCode = response.status;
							res.end(await response.text());
							return;
						}
						if (input.name === "error-fixture") {
							res.statusCode = 502;
							res.end(
								JSON.stringify({ error: "Provider unavailable. Try again." })
							);
							return;
						}
						if (input.name === "partial-fixture") {
							res.end(
								JSON.stringify({
									agent_id: "ryu",
									status: "partial",
									assessment: null,
									report:
										"The response was incomplete; no score could be validated.",
								})
							);
							return;
						}
						await new Promise((resolve) => setTimeout(resolve, 600));
						res.end(
							JSON.stringify({
								agent_id: "ryu",
								model: "proof-model",
								auditedAt: new Date().toISOString(),
								status: "complete",
								report: JSON.stringify(assessment),
								assessment: {
									...assessment,
									summary: `Review of ${input.name}. ${assessment.summary}`,
								},
							})
						);
						return;
					}
					res.statusCode = 404;
					res.end(JSON.stringify({ error: "Fixture route not configured" }));
				});
			},
		} satisfies Plugin,
	],
	define: { "process.env": {} },
	css: {
		postcss: {
			plugins: [tailwindcss()],
		},
	},
	root: harnessDir,
	clearScreen: false,
	resolve: {
		alias: {
			"@": desktopRoot,
		},
	},
	build: {
		outDir: path.resolve(harnessDir, "dist-health-audit-proof"),
		emptyOutDir: true,
		rollupOptions: {
			input: path.resolve(harnessDir, "health-audit-proof.html"),
		},
	},
	server: {
		host: "127.0.0.1",
		port: 5207,
		strictPort: true,
	},
});
