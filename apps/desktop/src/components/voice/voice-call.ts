/** Format the small elapsed-time readout used by the desktop voice call. */
export function formatVoiceCallDuration(totalSeconds: number): string {
	const seconds = Number.isFinite(totalSeconds)
		? Math.max(0, Math.floor(totalSeconds))
		: 0;
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

/** Turn an agent display name into a compact call-avatar label. */
export function getVoiceCallInitials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) {
		return "R";
	}
	if (words.length === 1) {
		return words[0]?.slice(0, 2).toUpperCase() ?? "R";
	}
	const first = words[0]?.[0] ?? "R";
	const last = words.at(-1)?.[0] ?? "Y";
	return `${first}${last}`.toUpperCase();
}
