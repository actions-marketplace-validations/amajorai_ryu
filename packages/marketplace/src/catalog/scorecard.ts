// Public marketplace scorecard entry point.
//
// The scoring contract is shared, while each listing realm owns a separate set
// of rules. Keep this facade stable so desktop, web, and host consumers do not
// need to know which rule module produced a scorecard.

export { runScorecard } from "./plugin-scorecard.ts";
export type {
	CategoryScore,
	CheckStatus,
	Scorecard,
	ScorecardCategory,
	ScorecardCheck,
	ScorecardGrade,
	ScorecardRulesetVersion,
} from "./scorecard-contract.ts";
export {
	CATEGORY_DESCRIPTIONS,
	CATEGORY_LABELS,
} from "./scorecard-contract.ts";
export { runSkillScorecard } from "./skill-scorecard.ts";
