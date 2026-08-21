const COMMON_AGENT_NAMES = [
	"Alex",
	"Amelia",
	"Anna",
	"Benjamin",
	"Chloe",
	"Daniel",
	"Eleanor",
	"Elijah",
	"Ella",
	"Emily",
	"Ethan",
	"Grace",
	"Hannah",
	"Henry",
	"Isabella",
	"Jack",
	"James",
	"Lucas",
	"Lucy",
	"Mason",
	"Mia",
	"Noah",
	"Oliver",
	"Olivia",
	"Oscar",
	"Rachel",
	"Robert",
	"Ruby",
	"Samuel",
	"Sofia",
	"Sophia",
	"Thomas",
	"Victoria",
	"William",
] as const;

export function pickCommonAgentName(
	current = "",
	random = Math.random()
): string {
	const candidates = COMMON_AGENT_NAMES.filter((name) => name !== current);
	const index = Math.min(
		candidates.length - 1,
		Math.max(0, Math.floor(random * candidates.length))
	);
	return candidates[index] ?? COMMON_AGENT_NAMES[0];
}

/** Extract a single useful name from a model response that may include a label or code fence. */
export function extractGeneratedAgentName(response: string): string | null {
	const firstLine = response
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line && !line.startsWith("```"));
	if (!firstLine) {
		return null;
	}

	const name = firstLine
		.replace(/^(?:name|suggested name)\s*:\s*/i, "")
		.replace(/^[-*]\s*/, "")
		.replace(/[.!?]+$/, "")
		.replace(/^['"]|['"]$/g, "")
		.trim()
		.replace(/\s+/g, " ");
	if (!/^[A-Z][a-z]{1,31}$/.test(name)) {
		return null;
	}
	return name;
}

export function buildAgentNamePrompt({
	instructions,
	title,
}: {
	instructions: string;
	title: string;
}): string {
	return [
		"Choose a name for a new Ryu agent.",
		"Return exactly one common English human first name, with no quotes, punctuation, explanation, or role title.",
		"Use the agent's purpose as a light hint, but keep the result a human first name.",
		`Role badge: ${title.trim() || "(not set)"}`,
		`Instructions: ${instructions.trim() || "(not set)"}`,
	].join("\n");
}
