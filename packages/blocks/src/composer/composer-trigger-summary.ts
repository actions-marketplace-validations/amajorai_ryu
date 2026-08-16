// How the composer's settings trigger reads at a glance.
//
// The trigger used to spell every active setting out as its own bulleted
// segment — `Ryu · Claude Sonnet 4.5 · Accept edits · High · Off` — which is
// four words of chrome for two facts. This module is the compaction, kept as
// pure data so it is testable without a renderer (same reason
// `composer-acp-sections.ts` splits its rules out):
//
//   • a permission/approval mode collapses to its ICON + colour, because the
//     tone already says what the word did (red alert = bypass, purple pencil =
//     accept edits). Only when the value has NO decoration does its text
//     survive — opencode's `build` matches none of the approval styles, and an
//     icon-less empty segment would silently drop the setting from view.
//   • reasoning effort rides ON the model segment rather than as another bullet,
//     because effort is a property of the run the model does. The renderer can
//     show that ownership as a bar meter. With no model segment to ride on it
//     keeps its own segment rather than losing the setting altogether.
//   • the ACP harness behind an agent whose name doesn't already imply it is
//     appended in parentheses (`Ryu (pi)`), so the agent segment answers "which
//     harness am I actually driving" without a bullet of its own.
//
// Nothing here is per-agent: the discriminators are the section's own shape —
// its key, whether its active value resolved a decoration, and whether it
// advertises an ordered scale (`variant: "slider"`).

/** The section key the Model picker is registered under (see the composer hook). */
export const MODEL_SECTION_KEY = "model";

/** One section, reduced to what the trigger needs to decide how to render it. */
export interface TriggerSummarySource {
	/**
	 * The active value resolved a decoration (icon + tone) — i.e. this section is
	 * a permission/approval mode whose value the shared style sheet recognises.
	 * Icon-only rendering keys off THIS, not off the section carrying a
	 * `decorate` callback: a decorating section whose current value matches no
	 * style would otherwise render as an empty gap.
	 */
	decorated: boolean;
	/** The section advertises an ordered effort scale (reasoning / thinking). */
	effort: boolean;
	key: string;
	/** Options are still being probed — the segment shows a spinner. */
	loading: boolean;
	/** The active value's display name (or the loading placeholder). */
	name: string;
}

/** One rendered segment of the trigger summary. */
export interface TriggerSummarySegment {
	/**
	 * Effort level folded onto this segment. Set only on the model segment; an
	 * effort with no model keeps a segment of its own. Renderers choose the
	 * density, such as a labelled bar meter or a compact icon treatment.
	 */
	effortName?: string;
	/**
	 * Render the decoration icon alone and keep {@link name} for `title` /
	 * `aria-label` — the mode's word is redundant next to its icon + colour, but
	 * dropping it from the accessible name would leave the mode unannounced.
	 */
	iconOnly: boolean;
	key: string;
	loading: boolean;
	name: string;
}

/**
 * Compose the trigger's segments from the visible sections, in section order.
 *
 * Sections arrive as `[agent, model, approval, …config options, style]`, so the
 * effort option is never adjacent to the model — it is hoisted here rather than
 * by reordering `sections`, which also drives the picker body.
 */
export function composeTriggerSummary(
	sources: TriggerSummarySource[]
): TriggerSummarySegment[] {
	const segments: TriggerSummarySegment[] = [];
	for (const source of sources) {
		const segment: TriggerSummarySegment = {
			key: source.key,
			name: source.name,
			iconOnly: source.decorated && !source.loading,
			loading: source.loading,
		};
		if (source.effort && !source.loading) {
			const model = segments.find(
				(s) => s.key === MODEL_SECTION_KEY && !s.loading && !s.effortName
			);
			if (model) {
				model.effortName = source.name;
				continue;
			}
		}
		segments.push(segment);
	}
	return segments;
}

/** Lowercase alphanumerics only, so `amp-acp` and `Amp ACP` compare equal. */
function normalizeForImplication(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The ACP harness to show in parentheses after an agent's name, or `null` when
 * the name already implies it.
 *
 * Every built-in external harness is named after the harness it runs
 * (`OpenCode` → `acp:opencode`, `Gemini CLI` → `gemini`), and `OpenCode
 * (opencode)` is noise. The flagship is the case that carries information: `Ryu`
 * runs the `pi` agent, and nothing on screen said so. So the suffix is dropped
 * whenever either string implies the other, and shown otherwise.
 *
 * `engine` is null for store-backed custom agents (Core's list endpoint omits
 * it), which simply means no suffix — never a guess.
 */
export function acpHarnessSuffix(
	agentName: string | null | undefined,
	engine: string | null | undefined
): string | null {
	if (!(agentName && engine)) {
		return null;
	}
	const harness = engine.replace(/^acp:/, "").trim();
	if (!harness) {
		return null;
	}
	const a = normalizeForImplication(agentName);
	const h = normalizeForImplication(harness);
	if (!(a && h) || a.includes(h) || h.includes(a)) {
		return null;
	}
	return harness;
}
