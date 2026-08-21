import { expect, test } from "@playwright/test";

test("posture slider applies coordinated controls and shows Doctor coverage", async ({
	page,
}) => {
	await page.goto("/gateway-posture-doctor-proof.html");

	await expect(page.getByTestId("proof-status")).toHaveText("VERIFIED");
	await expect(page.getByTestId("selected-posture")).toHaveText("Balanced");
	await expect(page.getByTestId("resolved-posture")).toHaveText("balanced");
	await expect(page.getByTestId("doctor-summary")).toContainText("1 warning");
	await expect(page.getByTestId("doctor-security")).toBeVisible();
	await expect(page.getByTestId("doctor-coverage")).toBeVisible();
	await expect(page.getByTestId("doctor-safety-state")).toHaveText(
		"At risk · safe redaction fix is available"
	);

	await page.getByTestId("doctor-run").click();
	await expect(page.getByTestId("doctor-run")).toContainText("· 1");
	await page.getByTestId("doctor-preview").click();
	await expect(page.getByTestId("doctor-safety-state")).toHaveText(
		"Dry run · nothing changed · firewall.redact_pii will be enabled"
	);
	await expect(page.getByTestId("doctor-apply")).toBeVisible();
	await page.getByTestId("doctor-apply").click();
	await expect(page.getByTestId("doctor-safety-state")).toHaveText(
		"Healthy · protective baseline is active"
	);
	await expect(page.getByTestId("doctor-summary")).toContainText("0 warnings");
	await expect(page.getByTestId("doctor-applied")).toContainText(
		"Applied 1 safe fix"
	);

	await page.getByTestId("posture-slider").fill("2");
	await expect(page.getByTestId("selected-posture")).toHaveText("Autonomous");
	await expect(page.getByTestId("gateway-policy")).toContainText("sanitize");
	await expect(page.getByTestId("core-approval")).toContainText("off");
	await expect(page.getByTestId("resolved-posture")).toHaveText("autonomous");

	await page.getByTestId("apply-posture").click();
	await expect(page.getByTestId("applied-posture")).toHaveText(
		"Applied · autonomous"
	);
});
