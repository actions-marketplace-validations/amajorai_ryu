/** Targets supported by the workspace file tree's default Open action. */
export const DEFAULT_FILE_OPENER_VALUES = [
	"system",
	"vscode",
	"cursor",
	"zed",
] as const;

export type DefaultFileOpener = (typeof DEFAULT_FILE_OPENER_VALUES)[number];

export function isDefaultFileOpener(value: string): value is DefaultFileOpener {
	return DEFAULT_FILE_OPENER_VALUES.includes(value as DefaultFileOpener);
}

export function normalizeDefaultFileOpener(
	value: string | null
): DefaultFileOpener {
	return value && isDefaultFileOpener(value) ? value : "system";
}
