import { useEffect, useState } from "react";

const KEY = "ryu_inverted_backgrounds";

function applyInvertedBackgrounds(enabled: boolean) {
	const root = document.documentElement;
	if (enabled) {
		root.setAttribute("data-inverted-backgrounds", "on");
	} else {
		root.removeAttribute("data-inverted-backgrounds");
	}
}

export function initInvertedBackgrounds() {
	applyInvertedBackgrounds(localStorage.getItem(KEY) === "true");
}

export function useInvertedBackgrounds(): boolean {
	const [enabled, setEnabled] = useState(
		() => localStorage.getItem(KEY) === "true"
	);

	useEffect(() => {
		const handler = () => {
			setEnabled(localStorage.getItem(KEY) === "true");
		};
		window.addEventListener("storage", handler);
		return () => window.removeEventListener("storage", handler);
	}, []);

	return enabled;
}

export function setInvertedBackgrounds(enabled: boolean) {
	localStorage.setItem(KEY, String(enabled));
	applyInvertedBackgrounds(enabled);
	window.dispatchEvent(new Event("storage"));
}
