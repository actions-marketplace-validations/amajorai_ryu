import { toast } from "@ryu/ui/components/sileo";
import { useEffect } from "react";
import {
	type CreditAlertEvent,
	openCreditAlertStream,
} from "@/src/lib/api/credits.ts";

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 10_000;

function osNotify(event: CreditAlertEvent): void {
	if (typeof Notification === "undefined") {
		return;
	}
	const show = () => {
		try {
			new Notification(event.title, {
				body: "Top up your Ryu credits to keep managed work running.",
				tag: "ryu-credit-alert",
			});
		} catch {
			// Notification construction can fail on browsers without OS support.
		}
	};
	if (Notification.permission === "granted") {
		show();
	} else if (Notification.permission === "default") {
		Notification.requestPermission()
			.then((permission) => {
				if (permission === "granted") {
					show();
				}
			})
			.catch(() => undefined);
	}
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true }
		);
	});
}

/** Subscribe once at the shell level so every claimed alert reaches the user. */
export function useCreditAlertEvents(): void {
	useEffect(() => {
		const controller = new AbortController();
		let backoff = INITIAL_BACKOFF_MS;

		const run = async () => {
			while (!controller.signal.aborted) {
				try {
					for await (const message of openCreditAlertStream(
						controller.signal
					)) {
						const event: CreditAlertEvent = message.data;
						toast.warning({
							title: event.title,
							description:
								"Top up your Ryu credits to keep managed work running.",
						});
						osNotify(event);
						backoff = INITIAL_BACKOFF_MS;
					}
				} catch {
					// Reconnect below; a transient cloud API failure must not affect the app.
				}
				if (controller.signal.aborted) {
					break;
				}
				await delay(backoff, controller.signal);
				backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
			}
		};
		run().catch(() => undefined);
		return () => controller.abort();
	}, []);
}
