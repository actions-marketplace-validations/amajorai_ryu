import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShowcaseDetail, AppShowcaseGallery } from "../app-showcase.tsx";
import { appShowcases } from "./app-showcase.tsx";

interface ManifestIdentity {
	id?: string;
	name?: string;
	tagline?: string;
}

const manifestPaths: Record<string, string> = {
	"@ryu/calendar": "apps-store/calendar/manifest.json",
	"@ryu/canvas": "apps-store/canvas/manifest.json",
	"@ryu/dashboards": "apps-store/dashboards/manifest.json",
	"@ryu/sites": "apps-store/sites/manifest.json",
	"@ryu/slides": "apps-store/slides/manifest.json",
	"@ryu/spaces": "apps/core/src/plugin_manifest/fixtures/spaces.manifest.json",
	"@ryu/video-studio": "apps-store/video-studio/manifest.json",
};

function readManifest(relativePath: string): ManifestIdentity {
	const root = join(import.meta.dir, "../../../../../");
	return JSON.parse(
		readFileSync(join(root, relativePath), "utf8")
	) as ManifestIdentity;
}

test("the showcase projection stays aligned with first-party manifest identity", () => {
	expect(appShowcases).toHaveLength(7);
	expect(new Set(appShowcases.map((app) => app.slug)).size).toBe(
		appShowcases.length
	);

	for (const app of appShowcases) {
		const manifestPath = manifestPaths[app.manifestId];
		expect(manifestPath).toBeDefined();
		const manifest = readManifest(manifestPath);
		expect(manifest.id).toBe(app.manifestId);
		expect(manifest.name).toBe(app.name);
		expect(manifest.tagline).toBe(app.tagline);
	}
});

test("the gallery and every detail page render a visible app path", () => {
	const gallery = renderToStaticMarkup(<AppShowcaseGallery />);
	expect(gallery.match(/data-app-showcase-card=/g)).toHaveLength(
		appShowcases.length
	);
	expect(gallery).toContain('data-testid="app-showcase-grid"');

	for (const app of appShowcases) {
		const detail = renderToStaticMarkup(
			<AppShowcaseDetail
				app={app}
				docsHref={`https://docs.ryuhq.com${app.docsPath}`}
				relatedApps={appShowcases.filter(
					(candidate) => candidate.slug !== app.slug
				)}
			/>
		);
		expect(gallery).toContain(`data-app-showcase-card="${app.slug}"`);
		expect(detail).toContain(`data-testid="app-showcase-detail-${app.slug}"`);
		expect(detail).toContain(app.manifestId);
		expect(detail).toContain(app.tagline);
		expect(detail).toContain(app.features[0].title);
		expect(detail).toContain("data-app-mockup");
	}
});
