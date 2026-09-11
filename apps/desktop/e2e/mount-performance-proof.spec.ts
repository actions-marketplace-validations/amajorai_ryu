import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("real companion bridge survives cosmetic renders and reconnects after document replacement", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto("/mount-performance-proof.html");
	const frame = page.frameLocator('iframe[title="Warmup companion"]');
	await expect(
		frame.getByRole("heading", { name: "Warmup", exact: true })
	).toBeVisible();
	await expect(page.getByTestId("connections")).toHaveText("1");
	await frame.getByLabel("Ping message").fill("Keep this draft");
	await page
		.getByRole("button", { name: "Update appearance", exact: true })
		.click();
	await expect(frame.getByLabel("Ping message")).toHaveValue("Keep this draft");
	await expect(page.getByTestId("connections")).toHaveText("1");
	await page
		.getByRole("button", { name: "Replace document", exact: true })
		.click();
	await expect(page.getByTestId("connections")).toHaveText("2");
	await expect(
		frame.getByRole("heading", { name: "Warmup", exact: true })
	).toBeVisible();
	await expect(page.getByTestId("reads")).toHaveText("4");
	expect(errors).toEqual([]);
	const dir = path.resolve(
		import.meta.dirname,
		"../../../docs/proof/performance-sweep"
	);
	await mkdir(dir, { recursive: true });
	await page.screenshot({
		path: path.join(dir, "mounting-completed.png"),
		fullPage: true,
		animations: "disabled",
	});
});

test("records cold and repeat mounts through the actual sandbox host", async ({
	page,
}) => {
	await page.goto("/mount-performance-proof.html");
	const samples = async () =>
		JSON.parse(
			(await page.getByTestId("mount-timings").textContent()) ?? "[]"
		) as Array<{
			version: number;
			wrapperMs: number;
			handshakeMs: number;
			readyMs: number;
		}>;
	await expect.poll(async () => (await samples()).length).toBe(1);
	for (let version = 2; version <= 6; version++) {
		await page
			.getByRole("button", { name: "Replace document", exact: true })
			.click();
		await expect.poll(async () => (await samples()).length).toBe(version);
	}
	const measured = await samples();
	for (const sample of measured) {
		expect(sample.readyMs).toBeGreaterThanOrEqual(sample.handshakeMs);
		expect(sample.handshakeMs).toBeGreaterThanOrEqual(sample.wrapperMs);
	}
	const sorted = measured
		.slice(1)
		.map((sample) => sample.readyMs)
		.sort((a, b) => a - b);
	const dir = path.resolve(
		import.meta.dirname,
		"../../../docs/proof/performance-sweep"
	);
	await mkdir(dir, { recursive: true });
	await writeFile(
		path.join(dir, "mount-timings.json"),
		`${JSON.stringify({ scope: "Local production Warmup HTML through ExtensionHost; excludes Core bundle HTTP and packaged Tauri", cold: measured[0], repeatMedianReadyMs: sorted[Math.floor(sorted.length / 2)], samples: measured }, null, 2)}\n`
	);
});
