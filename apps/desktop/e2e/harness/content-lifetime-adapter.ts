export function resolveAdapter() {
	return {
		id: "chatgpt",
		label: "Chat site",
		matches: () => true,
		getComposer: () => document.querySelector("textarea"),
		readComposer: (element: HTMLTextAreaElement) => element.value,
		setComposer: (element: HTMLTextAreaElement, text: string) => {
			element.value = text;
			element.dispatchEvent(new Event("input", { bubbles: true }));
		},
	};
}
