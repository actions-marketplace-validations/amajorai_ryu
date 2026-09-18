/** Release both the retry timer and listener when a subscription stops. */
export function waitForReconnect(
	signal: AbortSignal,
	delayMs: number
): Promise<void> {
	if (signal.aborted) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const finish = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", finish);
			resolve();
		};
		const timer = setTimeout(finish, delayMs);
		signal.addEventListener("abort", finish, { once: true });
	});
}
