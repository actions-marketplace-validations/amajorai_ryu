import type { ArtifactKind } from "./artifacts.ts";

// `unsafe-eval` supports self-compiling artifacts; the null-origin iframe and
// `connect-src 'none'` still prevent remote code or data exfiltration.
export const ARTIFACT_CSP =
	"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;
const DOCTYPE_RE = /^\s*<!doctype[^>]*>/i;
const FULL_DOC_RE = /<html[\s>]|<!doctype html/i;
const BASE_STYLE =
	":root{color-scheme:light dark}html,body{margin:0}body{padding:12px;box-sizing:border-box;font:14px/1.5 system-ui,-apple-system,sans-serif;background:Canvas;color:CanvasText}img,svg{max-width:100%;height:auto}svg{display:block;margin:0 auto}";

function wrapFragment(body: string): string {
	return `<!doctype html><html><head><meta charset="utf-8">${CSP_META}<style>${BASE_STYLE}</style></head><body>${body}</body></html>`;
}

/** Prefix the policy before parsing any model-controlled HTML token. */
function lockFullDocument(html: string): string {
	const content = html.replace(DOCTYPE_RE, "");
	return `<!doctype html><meta charset="utf-8">${CSP_META}${content}`;
}

/** Build the synchronous srcdoc for HTML/SVG artifacts. */
export function artifactSrcDoc(
	kind: ArtifactKind,
	content: string
): string | null {
	if (kind === "html") {
		return FULL_DOC_RE.test(content)
			? lockFullDocument(content)
			: wrapFragment(content);
	}
	if (kind === "svg") {
		return wrapFragment(content);
	}
	return null;
}
