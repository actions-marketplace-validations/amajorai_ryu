export type ChatTabBusySpeed = "slow" | "normal" | "fast";

const FAST_MODE_IDS = new Set(["fast", "fast-mode"]);
const ENABLED_VALUES = new Set(["1", "true", "on", "enabled", "yes"]);

function normalize(value: string | null | undefined): string {
	return (
		value
			?.trim()
			.toLowerCase()
			.replace(/[\s_]+/g, "-") ?? ""
	);
}

/** Whether the active ACP selection enables a provider's fast mode. */
export function isFastModeSelected(
	modeId: string | null,
	optionValues: Record<string, string>
): boolean {
	if (FAST_MODE_IDS.has(normalize(modeId))) {
		return true;
	}

	return Object.entries(optionValues).some(
		([optionId, value]) =>
			FAST_MODE_IDS.has(normalize(optionId)) &&
			ENABLED_VALUES.has(normalize(value))
	);
}

/** Map the chat stream phase to the speed used by sidebar/tab spinners. */
export function getChatTabBusySpeed(
	status: string,
	modeId: string | null,
	optionValues: Record<string, string>
): ChatTabBusySpeed {
	if (status !== "submitted") {
		return "normal";
	}

	return isFastModeSelected(modeId, optionValues) ? "fast" : "slow";
}
