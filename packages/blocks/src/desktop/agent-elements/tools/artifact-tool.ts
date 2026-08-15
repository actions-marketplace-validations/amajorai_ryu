import type { HostArtifact } from "../artifact-host-context.tsx";

/**
 * Pure helpers for the built-in artifact tool surface (`artifact__render` /
 * `artifact__create`). Kept free of the React component graph so the behavior is
 * unit-testable without dragging in the whole tool row renderer.
 */

/** Extract the `artifact` object out of a part's input — either a bare
 *  `artifact` key or the payload itself. Defensive against missing/loose shapes. */
export function artifactFromInput(input: unknown): HostArtifact | null {
	const value = input as Record<string, unknown> | null | undefined;
	if (!value || typeof value !== "object") {
		return null;
	}
	const nested = value.artifact;
	if (nested && typeof nested === "object") {
		return nested as HostArtifact;
	}
	if (value.kind || value.content || value.title || value.url) {
		return value as HostArtifact;
	}
	return null;
}

/** The `artifact__create` tool writes a file into a Space; its RESULT carries the
 *  doc identity + blob URL but not the title (that lived in the input). Rebuild a
 *  display payload from the two, so the card keeps the file name. */
export function artifactFromCreateResult(
	input: Record<string, unknown> | undefined,
	output: Record<string, unknown> | undefined
): HostArtifact | null {
	if (!output || typeof output !== "object") {
		return null;
	}
	if (output.ok === false || output.available === false) {
		return null;
	}
	const mime = typeof output.mime === "string" ? output.mime : undefined;
	const url = typeof output.url === "string" ? output.url : undefined;
	if (!url) {
		return null;
	}
	return {
		title:
			typeof input?.title === "string" && input.title.trim()
				? input.title
				: undefined,
		mime,
		url,
		spaceId: typeof output.space_id === "string" ? output.space_id : undefined,
		docId: typeof output.id === "string" ? output.id : undefined,
	};
}

/** A stable artifact id from a tool call id (never `Math.random`), so the same
 *  call always mints the same artifact across re-renders. */
export function artifactIdForPart(toolCallId: string | undefined): string {
	const base = toolCallId?.trim() ? toolCallId : "tool";
	return `artifact-${base}`;
}

/** True when a part is the built-in artifact surface (render or created file). */
export function isArtifactPart(
	partType: string,
	toolName: string | undefined
): boolean {
	return (
		partType === "tool-artifact__render" ||
		partType === "tool-artifact__create" ||
		(partType === "dynamic-tool" &&
			(toolName === "artifact__render" || toolName === "artifact__create"))
	);
}
