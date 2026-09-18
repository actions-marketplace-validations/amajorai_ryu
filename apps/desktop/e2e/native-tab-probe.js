// Read-only timing instrumentation for the isolated native performance session.
(() => {
	window.__ryuNativeTabProbe?.stop();
	const samples = { menu: [], library: [], chat: [] };
	const failures = [];
	const phases = { menu: [], library: [], chat: [] };
	const pending = new Set();
	const visible = (node) => Boolean(node?.getClientRects().length);
	const anyVisible = (selector, match = () => true) =>
		Array.from(document.querySelectorAll(selector)).some(
			(node) => visible(node) && match(node)
		);
	const ready = {
		menu: () => anyVisible("[data-tab-dropdown-menu]"),
		library: () =>
			anyVisible('input[placeholder^="Search your library"]') &&
			anyVisible("button,[role=button]", (node) =>
				node.textContent.includes("@ryu/chat-broadcast")
			),
		chat: () =>
			anyVisible('textarea,[contenteditable="true"]', (node) =>
				(node.value ?? node.textContent).includes("Native performance draft")
			),
	};
	function measure(kind) {
		const started = performance.now();
		const focused = document.hasFocus();
		const visibility = document.visibilityState;
		let done = false;
		let firstFrame;
		let secondFrame;
		const observer = new MutationObserver(check);
		const timer = setTimeout(() => {
			failures.push(kind);
			dispose();
		}, 10_000);
		function dispose() {
			done = true;
			observer.disconnect();
			clearTimeout(timer);
			cancelAnimationFrame(firstFrame);
			cancelAnimationFrame(secondFrame);
			pending.delete(dispose);
		}
		function check() {
			if (done || !ready[kind]()) {
				return;
			}
			done = true;
			observer.disconnect();
			clearTimeout(timer);
			const readyAt = performance.now();
			firstFrame = requestAnimationFrame(() => {
				const firstAt = performance.now();
				secondFrame = requestAnimationFrame(() => {
					phases[kind].push({
						readyMs: Math.round((readyAt - started) * 10) / 10,
						firstFrameMs: Math.round((firstAt - readyAt) * 10) / 10,
						secondFrameMs: Math.round((performance.now() - firstAt) * 10) / 10,
						focused,
						visibility,
					});
					samples[kind].push(
						Math.round((performance.now() - started) * 10) / 10
					);
					dispose();
				});
			});
		}
		pending.add(dispose);
		observer.observe(document.body, {
			childList: true,
			attributes: true,
			subtree: true,
		});
		check();
	}
	function click(event) {
		if (!(event.target instanceof Element)) {
			return;
		}
		const row = event.target.closest("[data-tab-search-id]");
		if (row && row.getAttribute("data-active") !== "true") {
			if (row.textContent.includes("/library")) {
				measure("library");
			} else if (row.textContent.includes("/chat")) {
				measure("chat");
			}
		} else if (event.target.closest("[data-tab-dropdown-trigger]")) {
			measure("menu");
		}
	}
	document.addEventListener("click", click, true);
	window.__ryuNativeTabProbe = {
		samples,
		failures,
		snapshot: () => ({
			samples,
			phases,
			failures,
			nodes: document.querySelectorAll("*").length,
			frames: document.querySelectorAll("iframe").length,
		}),
		stop: () => {
			document.removeEventListener("click", click, true);
			for (const dispose of pending) {
				dispose();
			}
		},
	};
})();
