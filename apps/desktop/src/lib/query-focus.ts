/** Keep TanStack polling aligned with actual browser/native-window visibility. */
export function observeQueryFocus(
	handleFocus: (focused: boolean) => void,
	target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
	page: Pick<
		Document,
		"addEventListener" | "removeEventListener" | "visibilityState" | "hasFocus"
	> = document
): () => void {
	const onFocus = () => handleFocus(page.visibilityState !== "hidden");
	const onBlur = () => handleFocus(false);
	const onVisibility = () =>
		handleFocus(page.visibilityState !== "hidden" && page.hasFocus());
	target.addEventListener("focus", onFocus);
	target.addEventListener("blur", onBlur);
	page.addEventListener("visibilitychange", onVisibility);
	onVisibility();
	return () => {
		target.removeEventListener("focus", onFocus);
		target.removeEventListener("blur", onBlur);
		page.removeEventListener("visibilitychange", onVisibility);
	};
}
