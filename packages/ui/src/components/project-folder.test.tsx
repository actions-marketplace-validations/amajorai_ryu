import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	getProjectFolderPreviewTransform,
	ProjectFolder,
} from "./project-folder.tsx";

describe("ProjectFolder", () => {
	test("renders closed folder semantics, title, count, and capped previews", () => {
		const html = renderToStaticMarkup(
			<ProjectFolder
				count={3}
				previews={[
					{ content: <span>One</span>, id: "one" },
					{ content: <span>Two</span>, id: "two" },
				]}
				title="Research"
			/>
		);

		expect(html).toContain('aria-haspopup="dialog"');
		expect(html).toContain('aria-expanded="false"');
		expect(html).toContain("Research");
		expect(html).toContain("3 items");
	});

	test("centers the middle preview in the fan", () => {
		expect(getProjectFolderPreviewTransform(2, 5)).toEqual({
			opacity: 1,
			scale: 1,
			x: 0,
			y: 0,
			rotate: 0,
			zIndex: 3,
		});
	});

	test("caps the rendered preview list at five items", () => {
		const html = renderToStaticMarkup(
			<ProjectFolder
				count={6}
				defaultOpen
				previews={Array.from({ length: 6 }, (_, index) => ({
					content: <span>{`Preview ${index + 1}`}</span>,
					id: `preview-${index + 1}`,
				}))}
				title="Research"
			/>
		);

		expect(html).toContain("Preview 5");
		expect(html).not.toContain("Preview 6");
	});
});
