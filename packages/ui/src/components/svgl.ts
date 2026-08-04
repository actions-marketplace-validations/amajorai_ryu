"use client";

// svgl.app brand marks, resolved by id — the colour half of the icon story.
//
// {@link iconToUrl} (icon.tsx) covers Iconify: 200k+ *monochrome* glyphs, painted
// with a CSS mask so they inherit `currentColor`. That is exactly wrong for a brand
// mark: masking Brave's orange lion or Firecrawl's flame flattens it to a
// single-colour silhouette. So branded listings resolve through here instead and
// render as a real `<img>`, in the brand's own colours.
//
// An id is `svgl:<slug>` — the slug svgl serves at `/library/<slug>.svg`. A brand
// whose mark needs a different treatment per theme can spell both out,
// `svgl:<light>|<dark>`; otherwise {@link useSvglRoute} fills the dark variant in
// from svgl's own API, which is where the per-brand `route` (a string, or a
// `{light, dark}` pair) is declared.

import { useSyncExternalStore } from "react";

const SVGL_LIBRARY = "https://svgl.app/library";

/** svgl's public index. One keyless GET returns every brand with its route(s). */
const SVGL_API = "https://api.svgl.app";

const SVGL_PREFIX = "svgl:";

/** A brand mark: the default (light-theme) URL, plus a dark-theme variant when
 *  the brand ships one. */
export interface SvglRoute {
	dark: string | null;
	light: string;
}

/** `https://svgl.app/library/<slug>.svg` for a bare slug. */
export function svglLibraryUrl(slug: string): string {
	return `${SVGL_LIBRARY}/${encodeURIComponent(slug)}.svg`;
}

/** True for an id this module owns (`svgl:brave`). */
export function isSvglIcon(icon: string | null | undefined): boolean {
	return typeof icon === "string" && icon.trim().startsWith(SVGL_PREFIX);
}

/**
 * Parse `svgl:<slug>` / `svgl:<light>|<dark>` into the two slugs. Returns null for
 * anything else, so callers can fall through to the Iconify resolver.
 *
 * Slugs are restricted to svgl's own filename alphabet: a manifest is untrusted
 * input, and `svgl:` must never become a way to point the renderer at an arbitrary
 * path (`../`, a protocol, a query string) on the CDN.
 */
export function parseSvglIcon(
	icon: string | null | undefined
): { dark: string | null; light: string } | null {
	if (!isSvglIcon(icon)) {
		return null;
	}
	const body = (icon as string).trim().slice(SVGL_PREFIX.length);
	const [light, dark] = body.split("|", 2).map((s) => s.trim());
	if (!isSafeSlug(light)) {
		return null;
	}
	return { light, dark: dark && isSafeSlug(dark) ? dark : null };
}

const SAFE_SLUG = /^[a-z0-9][a-z0-9._-]*$/i;

function isSafeSlug(value: string | undefined): value is string {
	return Boolean(value) && SAFE_SLUG.test(value as string);
}

// ---------------------------------------------------------------------------
// The svgl index: one lazy fetch per session, shared by every card.
// ---------------------------------------------------------------------------

interface SvglApiEntry {
	route?: string | { dark?: string; light?: string };
	title?: string;
}

let index: Map<string, SvglRoute> | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function slugOfRoute(url: string): string | null {
	const match = /\/([^/]+)\.svg(?:$|\?)/i.exec(url);
	return match?.[1] ?? null;
}

/** "Brave Browser" → "brave-browser", so a brand is findable by title too. */
function normalizeTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function buildIndex(entries: SvglApiEntry[]): Map<string, SvglRoute> {
	const map = new Map<string, SvglRoute>();
	for (const entry of entries) {
		const route = entry.route;
		let light: string | undefined;
		let dark: string | null = null;
		if (typeof route === "string") {
			light = route;
		} else if (route && typeof route === "object") {
			light = route.light;
			dark = route.dark ?? null;
		}
		if (!light) {
			continue;
		}
		const resolved: SvglRoute = { light, dark };
		const slug = slugOfRoute(light);
		if (slug) {
			map.set(slug.toLowerCase(), resolved);
		}
		if (entry.title) {
			const key = normalizeTitle(entry.title);
			// A slug is the more precise key — never let a title collision shadow one.
			if (key && !map.has(key)) {
				map.set(key, resolved);
			}
		}
	}
	return map;
}

/** Fetch the index once. Failure is silent and permanent for the session: every
 *  `svgl:` id still resolves through {@link svglLibraryUrl}, so a card shows the
 *  brand's light mark rather than nothing. */
function ensureIndex(): void {
	if (index || inFlight || typeof fetch !== "function") {
		return;
	}
	inFlight = fetch(SVGL_API)
		.then((res) => (res.ok ? res.json() : []))
		.then((json: unknown) => {
			index = buildIndex(Array.isArray(json) ? (json as SvglApiEntry[]) : []);
		})
		.catch(() => {
			index = new Map();
		})
		.finally(() => {
			inFlight = null;
			for (const listen of listeners) {
				listen();
			}
		});
}

/**
 * Resolve one `svgl:` id to its brand mark.
 *
 * The direct `/library/<slug>.svg` URL is returned immediately — nothing waits on
 * the network — and svgl's API index, once it lands, only ever ADDS the dark
 * variant for brands whose mark needs one. An explicit `svgl:<light>|<dark>` in
 * the manifest always wins over what the index says.
 */
export function resolveSvglIcon(
	icon: string | null | undefined,
	indexed: Map<string, SvglRoute> | null
): SvglRoute | null {
	const parsed = parseSvglIcon(icon);
	if (!parsed) {
		return null;
	}
	if (parsed.dark) {
		return {
			light: svglLibraryUrl(parsed.light),
			dark: svglLibraryUrl(parsed.dark),
		};
	}
	const hit = indexed?.get(parsed.light.toLowerCase());
	return hit ?? { light: svglLibraryUrl(parsed.light), dark: null };
}

function subscribe(listen: () => void): () => void {
	listeners.add(listen);
	ensureIndex();
	return () => {
		listeners.delete(listen);
	};
}

/** The module-level index IS the snapshot: it is replaced exactly once (or never),
 *  so its identity is a stable, correct `getSnapshot` — no per-render allocation
 *  and no tearing. */
function getIndex(): Map<string, SvglRoute> | null {
	return index;
}

/** Server render has no index and must not start a fetch. */
function getServerIndex(): null {
	return null;
}

/**
 * Subscribe to the svgl index, kicking off its one fetch on first use. Returns
 * null until it lands (and forever if it fails) — callers must stay useful then.
 *
 * `useSyncExternalStore` rather than local state: the index is process-wide, so a
 * grid of cards shares one fetch and one snapshot, and a card that mounts in the
 * window between the fetch resolving and its own effect running still reads the
 * loaded value instead of being stuck on null with no listener to wake it.
 */
export function useSvglIndex(): Map<string, SvglRoute> | null {
	return useSyncExternalStore(subscribe, getIndex, getServerIndex);
}
