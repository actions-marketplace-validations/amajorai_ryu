import { describe, expect, test } from "bun:test";
import type {
	SpaceDocument,
	SpaceDocumentContent,
} from "@/src/lib/api/spaces.ts";
import {
	eligibleSpaceDocuments,
	spaceDocumentPath,
	storeSpaceDocumentPreview,
} from "./SpaceProjectFolder.tsx";

function pageDocument(id: string): SpaceDocument {
	return documentFixture({ id, kind: "page", rawKind: "page" });
}

function databaseDocument(id: string): SpaceDocument {
	return documentFixture({ id, kind: "database", rawKind: "database" });
}

function fileDocument(id: string): SpaceDocument {
	return documentFixture({ id, kind: "page", rawKind: "file" });
}

function appDocument(id: string): SpaceDocument {
	return documentFixture({
		id,
		kind: "page",
		rawKind: "app:@ryu/whiteboard",
	});
}

function whiteboardDocument(id: string): SpaceDocument {
	return documentFixture({ id, kind: "whiteboard", rawKind: "whiteboard" });
}

function documentFixture({
	id,
	kind,
	rawKind,
}: Pick<SpaceDocument, "id" | "kind" | "rawKind">): SpaceDocument {
	return {
		byteSize: null,
		chunkCount: 0,
		createdAt: 0,
		icon: null,
		id,
		indexMessage: null,
		indexState: null,
		indexWarnings: [],
		kind,
		mime: null,
		rawKind,
		spaceId: "space-1",
		title: id,
		updatedAt: 0,
	};
}

function contentFixture(source: string): SpaceDocumentContent {
	return {
		chunkCount: 1,
		createdAt: 0,
		icon: null,
		id: "page",
		kind: "page",
		source,
		spaceId: "space-1",
		title: "Page",
		updatedAt: 0,
	};
}

describe("SpaceProjectFolder", () => {
	test("keeps only top-level page and database documents", () => {
		const rows = eligibleSpaceDocuments([
			pageDocument("page"),
			databaseDocument("db"),
			fileDocument("file"),
			appDocument("app"),
			whiteboardDocument("board"),
		]);

		expect(rows.map((row) => row.id)).toEqual(["page", "db"]);
	});

	test("maps page and database documents to their existing editor routes", () => {
		expect(spaceDocumentPath("space-1", pageDocument("page-1"))).toBe(
			"/spaces/space-1/doc/page-1"
		);
		expect(spaceDocumentPath("space-1", databaseDocument("db-1"))).toBe(
			"/spaces/space-1/db/db-1"
		);
	});

	test("prunes older timestamped cache entries when a preview is refreshed", () => {
		const cache = new Map<string, SpaceDocumentContent>();
		const oldDocument = { ...pageDocument("page"), updatedAt: 1 };
		const newDocument = { ...oldDocument, updatedAt: 2 };
		storeSpaceDocumentPreview(
			cache,
			"space-1",
			oldDocument,
			contentFixture("old")
		);
		storeSpaceDocumentPreview(
			cache,
			"space-1",
			newDocument,
			contentFixture("new")
		);

		expect([...cache.keys()]).toEqual(["space-1:page:2"]);
		expect(cache.get("space-1:page:2")?.source).toBe("new");
	});
});
