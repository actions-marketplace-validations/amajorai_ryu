import { describe, expect, test } from "bun:test";
import {
	findWorkspaceProject,
	normalizeWorkspaceProjects,
	primaryProjectFolder,
	projectIdForFolder,
	promoteProjectFolder,
	workspaceProjectName,
} from "./workspace-projects.ts";

describe("workspace projects", () => {
	test("migrates legacy folders into one-folder projects", () => {
		const projects = normalizeWorkspaceProjects(null, [
			"/work/web",
			"/work/api",
		]);

		expect(projects).toHaveLength(2);
		expect(projects[0]).toEqual({
			folders: ["/work/web"],
			id: projectIdForFolder("/work/web"),
		});
	});

	test("deduplicates equivalent source spellings and keeps primary first", () => {
		const [project] = normalizeWorkspaceProjects([
			{
				folders: ["/work/web/", "/work/web", "/work/api"],
				id: "decosmic",
				name: "Decosmic",
			},
		]);

		expect(project.folders).toEqual(["/work/web/", "/work/api"]);
		expect(primaryProjectFolder(project)).toBe("/work/web/");
		expect(findWorkspaceProject([project], "/work/api/")?.id).toBe("decosmic");
	});

	test("promotes a selected source folder without changing its spelling", () => {
		expect(
			promoteProjectFolder(
				["/work/web/", "/work/api", "/work/shared"],
				"/work/api/"
			)
		).toEqual(["/work/api", "/work/web/", "/work/shared"]);
		expect(promoteProjectFolder(["/work/web"], "/work/web")).toEqual([
			"/work/web",
		]);
		expect(promoteProjectFolder(["/work/web"], "/work/missing")).toEqual([
			"/work/web",
		]);
	});

	test("uses the saved project name before legacy and basename fallbacks", () => {
		const project = {
			folders: ["/work/web"],
			id: "decosmic",
			name: "Decosmic",
		};

		expect(workspaceProjectName(project, { "/work/web": "Old name" })).toBe(
			"Decosmic"
		);
		expect(
			workspaceProjectName(
				{ folders: ["/work/web/"], id: "legacy" },
				{ "/work/web": "Old name" }
			)
		).toBe("Old name");
		expect(
			workspaceProjectName({ folders: ["/work/web/"], id: "legacy" })
		).toBe("web");
	});
});
