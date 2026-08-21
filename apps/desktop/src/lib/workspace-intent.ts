/**
 * Local-project requests need a project context before they reach an agent. Keep
 * this deliberately conservative: a normal question about code or Git should
 * still work without a folder, while an explicit edit/run request gets a clear
 * project picker instead of silently using Core's process directory.
 */
const LOCAL_OBJECT_RE =
	/\b(?:api|app|branch|button|class|code|codebase|command|component|dependency|directory|endpoint|file|files|folder|function|github|hook|library|module|package|project|pull request|repo|repository|script|site|style|test|tests|terminal|ui|website)\b/i;
const LOCAL_ACTION_RE =
	/\b(?:build|change|create|delete|edit|fix|implement|modify|open|read|refactor|remove|rename|run|scan|test|update|write)\b/i;
const INFORMATIONAL_PREFIX_RE =
	/^(?:what|why|how|when|where|who|which|explain|tell me|describe)\b/i;

export function messageNeedsWorkspace(message: string): boolean {
	const text = message.trim();
	return (
		text.length > 0 &&
		!INFORMATIONAL_PREFIX_RE.test(text) &&
		LOCAL_OBJECT_RE.test(text) &&
		LOCAL_ACTION_RE.test(text)
	);
}
