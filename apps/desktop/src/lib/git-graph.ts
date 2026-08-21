export interface GitGraphCommit {
	author: string;
	date: string;
	parents: string[];
	refs: string[];
	sha: string;
	shortSha: string;
	subject: string;
}

export interface GitGraphBranch {
	current: boolean;
	name: string;
	sha: string;
}

export interface GitGraphRow {
	commit: GitGraphCommit;
	lane: number;
	parentLanes: number[];
}

const RECORD_SEPARATOR = "\x1e";

/** Parse the record-oriented `git log` output used by the Git graph surface. */
export function parseGitGraphLog(output: string): GitGraphCommit[] {
	return output
		.split(RECORD_SEPARATOR)
		.map((record) => record.trim())
		.filter(Boolean)
		.flatMap((record) => {
			const fields = record.split("\t");
			if (fields.length < 7) {
				return [];
			}
			const [
				sha,
				shortSha,
				author,
				date,
				parentField,
				refField,
				...subjectParts
			] = fields;
			if (!(sha && shortSha && author && date)) {
				return [];
			}
			return [
				{
					author,
					date,
					parents: parentField?.split(" ").filter(Boolean) ?? [],
					refs: parseDecorations(refField ?? ""),
					sha,
					shortSha,
					subject: subjectParts.join("\t").trim() || "Untitled commit",
				},
			] satisfies GitGraphCommit[];
		});
}

/** Parse `git branch --format` output into stable branch metadata. */
export function parseGitGraphBranches(output: string): GitGraphBranch[] {
	return output.split(/\r?\n/).flatMap((rawLine) => {
		const line = rawLine.replace(/\r$/, "");
		if (!line.trim()) {
			return [];
		}
		const [head, name, sha] = line.split("\t");
		if (!(name && sha)) {
			return [];
		}
		return [{ current: head === "*", name, sha }];
	});
}

/**
 * Turn commit parent relationships into the lane positions drawn by the UI.
 * The first parent stays in the current lane; merge parents open a new lane to
 * the right, which mirrors the compact graph treatment in Git clients.
 */
export function buildGitGraphRows(commits: GitGraphCommit[]): GitGraphRow[] {
	const lanes: string[] = [];
	const rows: GitGraphRow[] = [];

	for (const commit of commits) {
		let lane = lanes.indexOf(commit.sha);
		if (lane === -1) {
			lane = lanes.length;
			lanes.push(commit.sha);
		}

		const nextLanes = [...lanes];
		if (commit.parents.length === 0) {
			nextLanes.splice(lane, 1);
		} else {
			nextLanes[lane] = commit.parents[0] ?? commit.sha;
			for (const parent of commit.parents.slice(1)) {
				if (!nextLanes.includes(parent)) {
					nextLanes.splice(lane + 1, 0, parent);
				}
			}
		}

		rows.push({
			commit,
			lane,
			parentLanes: commit.parents.map((parent) => {
				const parentLane = nextLanes.indexOf(parent);
				return parentLane === -1 ? lane : parentLane;
			}),
		});
		lanes.splice(0, lanes.length, ...nextLanes);
	}

	return rows;
}

/** A small shell-safe guard for branch names interpolated into git commands. */
export function isSafeGitRef(ref: string): boolean {
	return (
		ref.length > 0 && !ref.startsWith("-") && /^[A-Za-z0-9._/-]+$/.test(ref)
	);
}

export function buildGitGraphLogCommand(branch?: string): string {
	const scope = branch && isSafeGitRef(branch) ? ` ${branch}` : " --all";
	return `git log${scope} --topo-order --decorate=short --date=relative --pretty=format:'%x1e%H%x09%h%x09%an%x09%ad%x09%P%x09%d%x09%s' -n 120`;
}

function parseDecorations(value: string): string[] {
	return value
		.replace(/^\s*\(|\)\s*$/g, "")
		.split(",")
		.map((ref) => ref.trim())
		.filter(Boolean)
		.map((ref) => (ref.startsWith("HEAD -> ") ? ref.slice(8) : ref));
}
