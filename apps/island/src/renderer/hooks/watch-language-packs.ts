import type { LanguagePack } from "@ryu/i18n/core";

/** Refresh the catalog only while visible, with one IPC read at a time. */
export function watchLanguagePacks(
	receive: (packs: LanguagePack[]) => void
): () => void {
	let alive = true;
	let pending = false;
	const refresh = async () => {
		if (!alive || pending || document.hidden) {
			return;
		}
		pending = true;
		try {
			const result = await window.island.languagePacks.get();
			if (alive && !document.hidden && result.available) {
				receive(result.packs);
			}
		} catch {
			/* Retain the current catalog until a later successful refresh. */
		} finally {
			pending = false;
		}
	};
	const automatic = () => {
		void refresh();
	};
	automatic();
	window.addEventListener("focus", automatic);
	document.addEventListener("visibilitychange", automatic);
	const timer = window.setInterval(automatic, 30_000);
	return () => {
		alive = false;
		window.removeEventListener("focus", automatic);
		document.removeEventListener("visibilitychange", automatic);
		window.clearInterval(timer);
	};
}
