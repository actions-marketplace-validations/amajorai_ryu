import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 360_000 });

test("moves visible context without crossing node credentials", async ({
	page,
}, testInfo) => {
	let sourceCredentialVerified = false;
	let destinationCredentialVerified = false;
	let firstResumeBody: string | null = null;
	let resumeAttempts = 0;

	await page.route(
		"**/source/api/rnp/v0/conversations/**/export",
		async (route) => {
			const request = route.request();
			const exportRequest = request.postDataJSON();
			expect(exportRequest.ifUpdatedAt).toBe(1_777_000_000_000);
			expect(request.headers().authorization).toBe("Bearer source-token");
			expect(request.headers().authorization).not.toContain(
				"destination-token"
			);
			sourceCredentialVerified = true;
			await route.fulfill({
				contentType: "application/json",
				body: JSON.stringify({
					protocol: "ryu-node-continuity",
					version: 0,
					bundleId: "bundle-proof",
					createdAt: 1_777_000_000_000,
					source: {
						conversationId: "conversation-proof",
						updatedAt: 1_777_000_000_000,
						title: "Research handoff",
						agentHint: "researcher",
					},
					selection: {
						transcript: { mode: "recent", maxMessages: 50 },
						omittedEarlierMessages: false,
					},
					messages: [
						{
							sourceId: "message-1",
							role: "user",
							text: "Compare the sources.",
							createdAt: 1_777_000_000_001,
						},
						{
							sourceId: "message-2",
							role: "assistant",
							text: "The evidence is ready for review.",
							createdAt: 1_777_000_000_002,
						},
					],
					context: { version: 0, items: [] },
				}),
			});
		}
	);

	await page.route(
		"**/destination/api/rnp/v0/conversations/**/resume",
		async (route) => {
			const request = route.request();
			expect(request.headers().authorization).toBe("Bearer destination-token");
			expect(request.headers().authorization).not.toContain("source-token");
			const bundle = request.postDataJSON();
			expect(bundle.context.items).toHaveLength(1);
			expect(bundle.context.items[0].text).toBe(
				"Focus the follow-up on the conflicting benchmarks."
			);
			const serializedBundle = JSON.stringify(bundle);
			resumeAttempts += 1;
			if (resumeAttempts === 1) {
				firstResumeBody = serializedBundle;
				await route.abort("connectionreset");
				return;
			}
			expect(serializedBundle).toBe(firstResumeBody);
			destinationCredentialVerified = true;
			await route.fulfill({
				contentType: "application/json",
				body: JSON.stringify({
					version: 0,
					conversationId: "conversation-proof",
					status: "created",
					imported: { messages: 2, contextItems: 1 },
					warnings: [],
				}),
			});
		}
	);

	await page.goto("/rnp-handoff-proof.html");
	await expect(
		page.getByRole("heading", { name: "Continue on another node" })
	).toBeVisible();
	await expect(page.getByText("Compare the sources.")).toBeVisible();
	await expect(
		page.getByText("The evidence is ready for review.")
	).toBeVisible();
	await page.getByLabel("Destination node").selectOption("Studio node");
	await page
		.getByLabel("Context note (optional)")
		.fill("Focus the follow-up on the conflicting benchmarks.");
	await page.getByLabel(/Suggest the same agent/).check();
	await page.getByRole("button", { name: "Continue on selected node" }).click();
	await expect(page.getByRole("alert")).toBeVisible();
	await page.getByRole("button", { name: "Retry same handoff" }).click();

	await expect(page.getByTestId("handoff-complete")).toContainText(
		"Conversation continued on Studio node"
	);
	await expect(
		page.getByRole("heading", { name: "Continue on another node" })
	).toBeHidden();
	expect(sourceCredentialVerified).toBe(true);
	expect(destinationCredentialVerified).toBe(true);
	expect(resumeAttempts).toBe(2);
	const proofScreenshot =
		process.env.RYU_RNP_PROOF_SCREENSHOT ??
		testInfo.outputPath("rnp-handoff-complete.png");
	await page.screenshot({ path: proofScreenshot, fullPage: true });
});
