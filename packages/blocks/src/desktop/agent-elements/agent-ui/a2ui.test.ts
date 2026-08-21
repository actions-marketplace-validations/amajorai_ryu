import { describe, expect, it } from "bun:test";
import { normalizeA2ui } from "./a2ui.ts";

const stream = [
	{
		version: "v0.9",
		createSurface: {
			surfaceId: "booking",
			catalogId:
				"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
		},
	},
	{
		version: "v0.9",
		updateDataModel: {
			surfaceId: "booking",
			path: "/reservation",
			value: { guests: "2" },
		},
	},
	{
		version: "v0.9",
		updateComponents: {
			surfaceId: "booking",
			components: [
				{
					id: "root",
					component: "Column",
					children: ["heading", "guests", "submit"],
				},
				{
					id: "heading",
					component: "Text",
					text: "Confirm reservation",
					variant: "h2",
				},
				{
					id: "guests",
					component: "TextField",
					label: "Guests",
					value: { path: "/reservation/guests" },
				},
				{
					id: "submit",
					component: "Button",
					child: "submit-label",
					action: {
						event: {
							name: "confirm",
							context: { reservation: { path: "/reservation" } },
						},
					},
				},
				{
					id: "submit-label",
					component: "Text",
					text: "Confirm",
				},
			],
		},
	},
];

describe("normalizeA2ui", () => {
	it("maps a v0.9 surface into the closed Ryu catalog", () => {
		const result = normalizeA2ui(stream);

		expect(result.spec).toMatchObject({
			root: "root",
			elements: {
				root: {
					type: "Stack",
					props: { direction: "column" },
					children: ["heading", "guests", "submit"],
				},
				heading: {
					type: "Heading",
					props: { text: "Confirm reservation", level: 2 },
				},
				guests: {
					type: "Input",
					props: {
						label: "Guests",
						value: { $bindState: "/reservation/guests" },
					},
				},
				submit: {
					type: "Button",
					props: { label: "Confirm" },
					on: {
						press: {
							action: "submit",
							params: {
								value: {
									protocol: "a2ui",
									name: "confirm",
									surfaceId: "booking",
									context: {
										reservation: { $state: "/reservation" },
									},
								},
							},
						},
					},
				},
			},
			state: { reservation: { guests: "2" } },
		});
		expect(result.issues).toEqual([]);
	});

	it("accepts JSONL and keeps unsupported components inert", () => {
		const result = normalizeA2ui(
			stream
				.map((message) => JSON.stringify(message))
				.concat(
					JSON.stringify({
						version: "v0.9",
						updateComponents: {
							surfaceId: "booking",
							components: [
								{ id: "root", component: "Modal", content: "unknown" },
							],
						},
					})
				)
				.join("\n")
		);

		expect(result.spec?.elements.root).toMatchObject({
			type: "Alert",
			props: { title: "Unsupported A2UI component", description: "Modal" },
		});
		expect(result.issues).toContain("A2UI component is not mapped: Modal");
	});

	it("rejects unsafe paths and executable function calls", () => {
		const result = normalizeA2ui([
			{
				createSurface: { surfaceId: "safe", catalogId: A2UI_BASIC_CATALOG_ID },
			},
			{
				updateDataModel: {
					surfaceId: "safe",
					path: "/__proto__/polluted",
					value: true,
				},
			},
			{
				updateComponents: {
					surfaceId: "safe",
					components: [
						{
							id: "root",
							component: "Text",
							text: { functionCall: { call: "execute" } },
						},
					],
				},
			},
		]);

		expect(result.spec?.state).toEqual({});
		expect(result.issues).toContain(
			"A2UI data model paths may not address prototype keys"
		);
		expect(result.issues).toContain(
			"A2UI functionCall expressions are not executed by Ryu"
		);
	});

	it("does not merge multiple surfaces into one native card", () => {
		const result = normalizeA2ui([
			{ createSurface: { surfaceId: "one" } },
			{
				updateComponents: {
					surfaceId: "one",
					components: [{ id: "root", component: "Text", text: "One" }],
				},
			},
			{ createSurface: { surfaceId: "two" } },
		]);

		expect(result.spec).toBeNull();
		expect(result.issues).toContain(
			"Ryu Agent UI currently renders one A2UI surface per card"
		);
	});
});

const A2UI_BASIC_CATALOG_ID =
	"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";
