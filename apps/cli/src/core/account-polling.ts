/** A view-owned observer of Core's device-login state, never the login itself. */
export function startAccountPolling(
	probe: (signal: AbortSignal) => Promise<boolean>,
	complete: (signedIn: boolean) => void,
	{ intervalMs, timeoutMs }: { intervalMs: number; timeoutMs: number }
): () => void {
	const controller = new AbortController();
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const stop = () => {
		if (stopped) {
			return;
		}
		stopped = true;
		clearTimeout(timer);
		clearTimeout(deadline);
		controller.abort();
	};
	const finish = (signedIn: boolean) => {
		if (stopped) {
			return;
		}
		stop();
		complete(signedIn);
	};
	const deadline = setTimeout(() => finish(false), timeoutMs);
	const tick = async () => {
		if (stopped) {
			return;
		}
		const signedIn = await probe(controller.signal).catch(() => false);
		if (stopped) {
			return;
		}
		if (signedIn) {
			finish(true);
		} else {
			timer = setTimeout(tick, intervalMs);
		}
	};
	timer = setTimeout(tick, intervalMs);
	return stop;
}
