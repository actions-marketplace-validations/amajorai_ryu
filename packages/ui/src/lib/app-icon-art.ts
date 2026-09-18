import artwork from "./app-icon-art.json" with { type: "json" };

/** Bundled first-party integration artwork; custom URLs keep normal caching. */
export function bundledIconArt(url: string | null | undefined): string | null {
	return url && Object.hasOwn(artwork, url)
		? artwork[url as keyof typeof artwork]
		: null;
}
