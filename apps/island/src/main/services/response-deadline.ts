/** The deadline owns the fetch and response consumption; no extra body buffering. */
export async function withResponseDeadline<T>(
	url: string,
	init: RequestInit,
	timeoutMs: number,
	consume: (response: Response) => Promise<T>
): Promise<T> {
	const controller = new AbortController();
	const caller = init.signal;
	caller?.throwIfAborted();
	const abort = () => controller.abort(caller?.reason);
	caller?.addEventListener("abort", abort, { once: true });
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const result = await consume(
			await fetch(url, { ...init, signal: controller.signal })
		);
		controller.signal.throwIfAborted();
		return result;
	} finally {
		clearTimeout(timer);
		caller?.removeEventListener("abort", abort);
		controller.abort();
	}
}
