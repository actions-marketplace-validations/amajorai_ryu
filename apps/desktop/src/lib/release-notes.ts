// apps/desktop/src/lib/release-notes.ts
//
// Turn a GitHub release body into something a TOAST can show.
//
// The update toasts used to pass `verdict.notes` straight into sileo's
// `description`, which renders a string verbatim — so the user got the raw
// markdown source of a release body: `### Install`, a `| macOS | Windows |`
// table, two fenced `curl | sh` blocks, `**gateway**:` scopes and backticked
// commit shas. Unreadable, and mostly not even about the update.
//
// Rendering that markdown properly would not fix it. Look at what a real body
// contains (the v0.1.3 one is the fixture in the tests): the first ~60% is
// install instructions for people who do NOT have the app — exactly the audience
// a toast inside the running app does not have. The fix is SELECTION first,
// formatting second:
//
//   1. drop boilerplate sections (Install / Download / Checksums / …),
//   2. drop block constructs a toast cannot render legibly (tables, fenced code,
//      images, raw HTML),
//   3. keep the changelog bullets, clipped to a handful,
//   4. parse the inline markdown that survives into typed segments so the
//      renderer can emphasise a scope without shipping a markdown engine — and
//      without `dangerouslySetInnerHTML` on text that came off the network.
//
// Pure and framework-free so it can be unit-tested against real release bodies;
// the JSX lives in `components/updater/ReleaseNotes.tsx`.

/** One run of inline text with the emphasis the markdown asked for. */
export interface NoteSegment {
	bold?: boolean;
	code?: boolean;
	text: string;
}

/** A heading plus the bullets kept under it. `title` is null for a lead paragraph. */
export interface NoteSection {
	items: NoteSegment[][];
	title: string | null;
}

export interface ReleaseNotesSummary {
	sections: NoteSection[];
	/** True when anything was dropped, so the UI can offer "full release notes". */
	truncated: boolean;
}

/** Headings whose content is install/boilerplate, not "what changed". */
const BOILERPLATE_HEADINGS = new Set([
	"install",
	"installation",
	"installing",
	"download",
	"downloads",
	"assets",
	"checksums",
	"verify",
	"verification",
	"getting started",
	"full changelog",
	"whats changed",
]);

// Sized against a real body in a real toast (see
// `e2e/harness/update-toast-story.tsx`): two headings and four bullets is the
// point where the toast still reads as a toast. A third section on the v0.1.3
// body is "Documentation: correct release_version's account of how rolling tags
// are versioned" — true, and not why anyone installs an update.
const MAX_SECTIONS = 2;
const MAX_ITEMS = 4;
const MAX_ITEM_CHARS = 140;

const HEADING = /^#{1,6}\s+(.*)$/;
const BULLET = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/;
const FENCE = /^\s*(?:```|~~~)/;

/** Heading text reduced to a comparable key: no markdown, no punctuation. */
function headingKey(raw: string): string {
	return raw
		.replace(/[*_`#]/g, "")
		.replace(/[^a-z0-9 ]/gi, "")
		.trim()
		.toLowerCase();
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]*\))/g;

/**
 * Split inline markdown into typed segments.
 *
 * Handles the three constructs a Ryu release body actually uses — `**scope**`,
 * `` `code` ``, and `[label](url)` — and leaves everything else as literal text.
 * A deliberately small parser: the alternative is pulling a markdown renderer
 * into a toast, and the input is untrusted network text, so the narrow surface is
 * the point.
 */
export function parseInline(raw: string): NoteSegment[] {
	const segments: NoteSegment[] = [];
	let cursor = 0;
	const push = (text: string, mark?: Omit<NoteSegment, "text">) => {
		if (text !== "") {
			segments.push({ text, ...mark });
		}
	};
	// `matchAll` needs the global flag, which carries `lastIndex` state — build a
	// fresh regex per call rather than sharing one module-level object.
	for (const match of raw.matchAll(new RegExp(INLINE.source, "g"))) {
		const token = match[0];
		const at = match.index ?? 0;
		push(raw.slice(cursor, at));
		cursor = at + token.length;
		if (token.startsWith("**")) {
			push(token.slice(2, -2), { bold: true });
		} else if (token.startsWith("`")) {
			push(token.slice(1, -1), { code: true });
		} else {
			// `[label](url)` — the label is the readable part; a toast has nowhere
			// to put the href, and the "full release notes" link covers the escape.
			push(token.slice(1, token.indexOf("]")));
		}
	}
	push(raw.slice(cursor));
	return segments;
}

/** Total characters in a segment run. */
function segmentsLength(segments: NoteSegment[]): number {
	return segments.reduce((sum, s) => sum + s.text.length, 0);
}

/** Clip a segment run to `MAX_ITEM_CHARS`, appending an ellipsis. */
function clip(segments: NoteSegment[]): NoteSegment[] {
	if (segmentsLength(segments) <= MAX_ITEM_CHARS) {
		return segments;
	}
	const out: NoteSegment[] = [];
	let used = 0;
	for (const segment of segments) {
		const room = MAX_ITEM_CHARS - used;
		if (room <= 0) {
			break;
		}
		if (segment.text.length <= room) {
			out.push(segment);
			used += segment.text.length;
			continue;
		}
		out.push({ ...segment, text: segment.text.slice(0, room).trimEnd() });
		break;
	}
	out.push({ text: "…" });
	return out;
}

/**
 * A trailing commit sha (`` (`386b482`) ``) is provenance, not a change — it is
 * pure noise in a toast and eats the character budget the actual sentence needs.
 */
function stripTrailingSha(raw: string): string {
	return raw.replace(/\s*\(`[0-9a-f]{7,40}`\)\s*$/i, "").trimEnd();
}

/** Lines that carry no readable text in a toast. */
function isDroppableLine(line: string): boolean {
	const trimmed = line.trim();
	return (
		trimmed === "" ||
		// Table row or separator.
		trimmed.startsWith("|") ||
		// Blockquote, raw HTML, image, horizontal rule.
		trimmed.startsWith(">") ||
		trimmed.startsWith("<") ||
		trimmed.startsWith("![") ||
		/^([-*_])\1{2,}$/.test(trimmed.replace(/\s/g, ""))
	);
}

/**
 * Condense a release body into at most {@link MAX_ITEMS} bullets under at most
 * {@link MAX_SECTIONS} headings.
 *
 * Returns `null` when nothing readable survives, which callers treat as "no
 * notes" and replace with their own one-liner — a toast with an empty body reads
 * as a rendering bug.
 */
export function summarizeReleaseNotes(
	body: string | null | undefined
): ReleaseNotesSummary | null {
	if (!body || body.trim() === "") {
		return null;
	}

	const lines = body.split(/\r?\n/);
	// A body that has real headings ("### Fixes") also has a lead paragraph of
	// provenance above them — "Built from commit `386b482`." — which is not a
	// change and would eat one of the few item slots. When headings exist they ARE
	// the changelog, so the untitled lead is skipped; when they do not, the prose
	// is all there is and gets kept below.
	const hasKeptHeading = lines.some((line) => {
		const heading = HEADING.exec(line);
		return (
			heading !== null &&
			!BOILERPLATE_HEADINGS.has(headingKey((heading[1] ?? "").trim()))
		);
	});

	const sections: NoteSection[] = [];
	let current: NoteSection = { title: null, items: [] };
	let skipping = hasKeptHeading;
	let inFence = false;
	let dropped = false;
	let kept = 0;

	const flush = () => {
		if (current.items.length > 0) {
			sections.push(current);
		}
	};

	for (const line of lines) {
		if (FENCE.test(line)) {
			inFence = !inFence;
			dropped = true;
			continue;
		}
		if (inFence) {
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading) {
			flush();
			const title = (heading[1] ?? "").trim();
			skipping = BOILERPLATE_HEADINGS.has(headingKey(title));
			if (skipping) {
				dropped = true;
			}
			current = { title: title === "" ? null : title, items: [] };
			continue;
		}
		if (skipping || isDroppableLine(line)) {
			dropped = dropped || line.trim() !== "";
			continue;
		}

		const bullet = BULLET.exec(line);
		// Prose outside a bullet list is kept too — a small release ("Fixes a crash
		// on launch.") has no list at all, and dropping it would leave the toast
		// with nothing to say.
		const text = stripTrailingSha(bullet ? (bullet[1] ?? "") : line.trim());
		if (text === "") {
			continue;
		}
		if (kept >= MAX_ITEMS || sections.length >= MAX_SECTIONS) {
			dropped = true;
			continue;
		}
		current.items.push(clip(parseInline(text)));
		kept += 1;
	}
	flush();

	if (sections.length === 0) {
		return null;
	}
	return { sections: sections.slice(0, MAX_SECTIONS), truncated: dropped };
}
