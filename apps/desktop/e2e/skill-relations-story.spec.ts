import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("renders and filters the Skills Relations view", async ({
	page,
}, testInfo) => {
	await page.goto("/skill-relations-story.html");
	await page
		.getByTestId("skill-relations-toggle")
		.getByRole("button", {
			name: "Relations view",
		})
		.click();

	const graph = page.getByTestId("skill-relations-graph");
	await expect(graph).toBeVisible();
	await expect(page.getByTestId("skill-relations-legend")).toContainText(
		"Agent access"
	);
	await expect(page.getByTestId("skill-relations-usage-note")).toContainText(
		"Your observed usage"
	);
	await expect(page.getByTestId("skill-relation-node-agent")).toHaveCount(2);
	await expect(page.getByTestId("skill-relation-node-skill")).toHaveCount(3);
	await expect(page.getByTestId("skill-relation-node-tool")).toHaveCount(3);

	const research = page.getByLabel("skill: Research");
	await research.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("skill-relations-details")).toContainText(
		"Direct relationships"
	);
	await page.screenshot({
		path: testInfo.outputPath("skill-relations-proof.png"),
	});

	await page.getByRole("textbox", { name: "Search relations" }).fill("browser");
	await expect(page.getByTestId("skill-relation-node-skill")).toHaveCount(2);
	await expect(page.getByTestId("skill-relation-node-tool")).toHaveCount(1);
	await expect(page.getByTestId("skill-relation-node-agent")).toHaveCount(0);
});

test("stacks the details panel on a narrow viewport", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/skill-relations-story.html");
	await page
		.getByTestId("skill-relations-toggle")
		.getByRole("button", {
			name: "Relations view",
		})
		.click();

	await expect(page.getByTestId("skill-relations-graph")).toBeVisible();
	await page.getByLabel("skill: Research").focus();
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("skill-relations-details")).toBeVisible();
});
