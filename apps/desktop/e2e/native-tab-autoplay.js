// Controlled native-webview replay. Load through Web Inspector, then close it.
setTimeout(async () => {
	window.__ryuNativeReactProfile?.reset();
	const probe = window.__ryuNativeTabProbe;
	for (const values of Object.values(probe.samples)) {
		values.length = 0;
	}
	probe.failures.length = 0;
	window.__nativeAutomaticDone = false;
	window.__nativeAutomaticError = null;
	const waitFor = async (predicate) => {
		const start = performance.now();
		while (!predicate()) {
			if (performance.now() - start > 5000) {
				throw new Error("Native replay timed out");
			}
			await new Promise(requestAnimationFrame);
		}
	};
	try {
		for (let index = 0; index < 24; index++) {
			const kind = index % 2 === 0 ? "chat" : "library";
			const trigger = Array.from(
				document.querySelectorAll("[data-tab-dropdown-trigger]")
			).find((node) => node.getClientRects().length);
			trigger.click();
			await waitFor(() =>
				Array.from(document.querySelectorAll("[data-tab-search-id]")).some(
					(node) => node.getClientRects().length
				)
			);
			const row = Array.from(
				document.querySelectorAll("[data-tab-search-id]")
			).find((node) =>
				node.textContent.includes(kind === "chat" ? "/chat" : "/library")
			);
			const count = probe.samples[kind].length;
			row.click();
			await waitFor(() => probe.samples[kind].length > count);
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		window.__nativeReactCaptured = window.__ryuNativeReactProfile?.snapshot();
		window.__nativeAutomaticDone = true;
	} catch (error) {
		window.__nativeAutomaticError = String(error);
	}
}, 3000);
