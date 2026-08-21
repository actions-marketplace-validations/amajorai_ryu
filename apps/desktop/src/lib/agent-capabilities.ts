/**
 * Shared encoding for the capability defaults used by the agent editor and
 * compact settings surfaces.
 *
 * Core treats an empty skill list as the legacy "all enabled" value, while
 * `*` is the live all-tools marker. The private no-capabilities marker lets a
 * user intentionally turn every item in a category off without confusing that
 * state with the legacy empty default.
 */

export const ALL_MCP_TOOLS = "*";
export const NO_AGENT_CAPABILITIES = "__ryu_none__";

export interface SkillCapability {
	enabled: boolean;
	id: string;
}

export function hydrateToolSelection(
	configured: readonly string[],
	available: readonly string[],
	isNew: boolean
): Set<string> {
	if (isNew || configured.length === 0 || configured.includes(ALL_MCP_TOOLS)) {
		return new Set(available);
	}
	if (configured.includes(NO_AGENT_CAPABILITIES)) {
		return new Set();
	}
	return new Set(configured);
}

export function hydrateSkillSelection(
	configured: readonly string[],
	available: readonly SkillCapability[],
	isNew: boolean
): Set<string> {
	if (configured.includes(NO_AGENT_CAPABILITIES)) {
		return new Set();
	}
	if (isNew || configured.length === 0) {
		return new Set(
			available.filter((skill) => skill.enabled).map((skill) => skill.id)
		);
	}
	return new Set(configured);
}

export function encodeToolAllowlist(
	available: readonly string[],
	selected: ReadonlySet<string>
): string[] {
	const allSelected =
		available.length > 0 &&
		selected.size === available.length &&
		available.every((tool) => selected.has(tool));
	if (allSelected || available.length === 0) {
		return [ALL_MCP_TOOLS];
	}
	if (selected.size === 0) {
		return [NO_AGENT_CAPABILITIES];
	}
	return [...selected];
}

export function encodeSkillAllowlist(
	available: readonly SkillCapability[],
	selected: ReadonlySet<string>
): string[] {
	const enabledIds = available
		.filter((skill) => skill.enabled)
		.map((skill) => skill.id);
	const allEnabledSelected =
		enabledIds.length > 0 &&
		selected.size === enabledIds.length &&
		enabledIds.every((id) => selected.has(id));
	if (allEnabledSelected) {
		return [];
	}
	if (selected.size === 0 && enabledIds.length > 0) {
		return [NO_AGENT_CAPABILITIES];
	}
	return [...selected];
}
