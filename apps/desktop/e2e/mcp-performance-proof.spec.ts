import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("tools library shares registry reads and fetches only tools on agent filter changes", async ({
	page,
}) => {
	const calls: Record<string, number> = {};
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.route("**/api/**", async (route) => {
		const url = new URL(route.request().url());
		if (!url.pathname.startsWith("/api/")) {
			return route.continue();
		}
		const key = url.pathname + url.search;
		calls[key] = (calls[key] ?? 0) + 1;
		const payloads: Record<string, unknown> = {
			"/api/mcp/servers": {
				servers: [
					{
						name: "Workspace",
						command: "fixture",
						enabled: true,
						available: true,
						description: "Local workspace tools",
						transport: "stdio",
					},
				],
			},
			"/api/mcp/tools": {
				tools: [
					{
						id: "Workspace.search",
						name: "Search files",
						server: "Workspace",
						description: "Find workspace documents",
						input_schema: { type: "object" },
					},
				],
			},
			"/api/mcp/tools?agent=agent-a": {
				tools: [
					{
						id: "Workspace.search",
						name: "Search files",
						server: "Workspace",
						description: "Allowed for Research agent",
						input_schema: { type: "object" },
					},
				],
			},
			"/api/agents": { agents: [{ id: "agent-a", name: "Research agent" }] },
			"/api/apps": { apps: [] },
			"/api/identities": { profiles: [] },
		};
		await route.fulfill({ json: payloads[key] ?? {} });
	});
	await page.goto("/mcp-performance-proof.html");
	await expect(
		page.getByText("Workspace", { exact: true }).first()
	).toBeVisible();
	expect(calls["/api/mcp/servers"]).toBe(1);
	expect(calls["/api/mcp/tools"]).toBe(1);
	expect(calls["/api/agents"]).toBe(1);
	await page.getByRole("button", { name: "Add consumer", exact: true }).click();
	expect(calls["/api/mcp/servers"]).toBe(1);
	await page.getByRole("button", { name: "Filter & add", exact: true }).click();
	await page.getByRole("combobox", { name: "Allowlist", exact: true }).click();
	await page
		.getByRole("option", { name: "Research agent", exact: true })
		.click();
	await expect.poll(() => calls["/api/mcp/tools?agent=agent-a"]).toBe(1);
	expect(calls["/api/mcp/servers"]).toBe(1);
	expect(calls["/api/agents"]).toBe(1);
	await page.keyboard.press("Escape");
	expect(errors).toEqual([]);
	const dir = path.resolve(
		import.meta.dirname,
		"../../../docs/proof/performance-sweep"
	);
	await mkdir(dir, { recursive: true });
	await page.screenshot({
		path: path.join(dir, "mcp-library-completed.png"),
		fullPage: true,
		animations: "disabled",
	});
	await writeFile(
		path.join(dir, "mcp-reads.json"),
		`${JSON.stringify({ initialConsumers: 4, initialRegistryReads: 3, warmConsumerExtraReads: 0, agentFilterExtraReads: 1, calls, scope: "Actual ToolsLibrary and MCP hooks against controlled HTTP" }, null, 2)}\n`
	);
});
