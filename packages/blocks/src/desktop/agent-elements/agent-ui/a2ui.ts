import type { AgentUiSpec } from "./template.ts";

/** The A2UI catalog Ryu currently knows how to map into its native catalog. */
export const A2UI_BASIC_CATALOG_IDS = [
	"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
	"https://a2ui.org/specification/v0_9.1/catalogs/basic/catalog.json",
] as const;

const MAX_MESSAGES = 128;
const MAX_COMPONENTS = 100;
const MAX_ID_LENGTH = 128;
const MAX_COMPONENT_NAME_LENGTH = 64;
const MAX_ISSUES = 32;
const FORBIDDEN_POINTER_SEGMENTS = new Set([
	"__proto__",
	"constructor",
	"prototype",
]);

type JsonObject = Record<string, unknown>;

interface A2uiComponent extends JsonObject {
	component: string;
	id: string;
}

interface A2uiCreateSurface extends JsonObject {
	catalogId?: string;
	surfaceId: string;
}

interface A2uiUpdateComponents extends JsonObject {
	components: A2uiComponent[];
	surfaceId: string;
}

interface A2uiUpdateDataModel extends JsonObject {
	path?: string;
	surfaceId: string;
	value?: unknown;
}

interface A2uiDeleteSurface extends JsonObject {
	surfaceId: string;
}

interface A2uiMessage {
	createSurface?: A2uiCreateSurface;
	deleteSurface?: A2uiDeleteSurface;
	updateComponents?: A2uiUpdateComponents;
	updateDataModel?: A2uiUpdateDataModel;
	version?: string;
}

export type AgentUiRenderSpec = AgentUiSpec & {
	state?: Record<string, unknown>;
};

export interface A2uiNormalizationResult {
	issues: string[];
	spec: AgentUiRenderSpec | null;
	surfaceId?: string;
}

interface SurfaceState {
	catalogId?: string;
	components: Map<string, A2uiComponent>;
	dataModel: unknown;
	id: string;
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, maxLength: number): string | null {
	return typeof value === "string" &&
		value.length > 0 &&
		value.length <= maxLength
		? value
		: null;
}

function pushIssue(issues: string[], message: string): void {
	if (issues.length < MAX_ISSUES && !issues.includes(message)) {
		issues.push(message);
	}
}

function parseVersion(value: unknown, issues: string[]): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value !== "v0.9" && value !== "v0.9.1") {
		pushIssue(issues, `Unsupported A2UI protocol version: ${String(value)}`);
		return undefined;
	}
	return value;
}

function parseSurfaceId(
	value: unknown,
	operation: string,
	issues: string[]
): string | null {
	const surfaceId = stringValue(value, MAX_ID_LENGTH);
	if (!surfaceId) {
		pushIssue(issues, `${operation} requires a bounded string surfaceId`);
	}
	return surfaceId;
}

function parseMessage(
	input: unknown,
	index: number,
	issues: string[]
): A2uiMessage | null {
	if (!isObject(input)) {
		pushIssue(issues, `A2UI message ${index + 1} must be an object`);
		return null;
	}

	const version = parseVersion(input.version, issues);
	const operations = [
		"createSurface",
		"updateComponents",
		"updateDataModel",
		"deleteSurface",
	].filter((key) => key in input);
	if (operations.length !== 1) {
		pushIssue(
			issues,
			`A2UI message ${index + 1} must contain exactly one supported operation`
		);
		return null;
	}

	const operation = operations[0];
	const payload = input[operation];
	if (!isObject(payload)) {
		pushIssue(issues, `A2UI ${operation} payload must be an object`);
		return null;
	}

	if (operation === "createSurface") {
		const surfaceId = parseSurfaceId(payload.surfaceId, operation, issues);
		if (!surfaceId) {
			return null;
		}
		const catalogId =
			payload.catalogId === undefined
				? undefined
				: stringValue(payload.catalogId, 512);
		if (payload.catalogId !== undefined && !catalogId) {
			pushIssue(
				issues,
				"A2UI createSurface catalogId must be a bounded string"
			);
			return null;
		}
		return {
			version,
			createSurface: {
				...payload,
				surfaceId,
				catalogId: catalogId ?? undefined,
			},
		};
	}

	if (operation === "updateComponents") {
		const surfaceId = parseSurfaceId(payload.surfaceId, operation, issues);
		if (!(surfaceId && Array.isArray(payload.components))) {
			pushIssue(issues, "A2UI updateComponents requires a components array");
			return null;
		}
		const components: A2uiComponent[] = [];
		for (const [componentIndex, rawComponent] of payload.components.entries()) {
			if (!isObject(rawComponent)) {
				pushIssue(
					issues,
					`A2UI component ${componentIndex + 1} in message ${index + 1} must be an object`
				);
				continue;
			}
			const id = stringValue(rawComponent.id, MAX_ID_LENGTH);
			const component = stringValue(
				rawComponent.component,
				MAX_COMPONENT_NAME_LENGTH
			);
			if (!(id && component)) {
				pushIssue(
					issues,
					`A2UI component ${componentIndex + 1} needs bounded id and component fields`
				);
				continue;
			}
			components.push({ ...rawComponent, id, component });
		}
		return { version, updateComponents: { ...payload, surfaceId, components } };
	}

	if (operation === "updateDataModel") {
		const surfaceId = parseSurfaceId(payload.surfaceId, operation, issues);
		const path = payload.path === undefined ? "/" : payload.path;
		if (!surfaceId || typeof path !== "string" || !path.startsWith("/")) {
			pushIssue(
				issues,
				"A2UI updateDataModel path must be an absolute JSON Pointer"
			);
			return null;
		}
		return {
			version,
			updateDataModel: { ...payload, path, surfaceId },
		};
	}

	const surfaceId = parseSurfaceId(payload.surfaceId, operation, issues);
	return surfaceId
		? { version, deleteSurface: { ...payload, surfaceId } }
		: null;
}

function parseInput(input: unknown, issues: string[]): A2uiMessage[] {
	let rawMessages: unknown[];
	if (typeof input === "string") {
		rawMessages = input
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line, index) => {
				try {
					return JSON.parse(line) as unknown;
				} catch {
					pushIssue(issues, `A2UI JSONL line ${index + 1} is not valid JSON`);
					return null;
				}
			});
	} else if (Array.isArray(input)) {
		rawMessages = input;
	} else if (isObject(input) && Array.isArray(input.messages)) {
		rawMessages = input.messages;
	} else {
		rawMessages = [input];
	}

	if (rawMessages.length > MAX_MESSAGES) {
		pushIssue(
			issues,
			`A2UI streams may contain at most ${MAX_MESSAGES} messages`
		);
		rawMessages = rawMessages.slice(0, MAX_MESSAGES);
	}
	return rawMessages.flatMap((message, index) => {
		const parsed = parseMessage(message, index, issues);
		return parsed ? [parsed] : [];
	});
}

function decodePointerSegment(segment: string): string | null {
	const decoded = segment.replaceAll("~1", "/").replaceAll("~0", "~");
	return FORBIDDEN_POINTER_SEGMENTS.has(decoded) ? null : decoded;
}

function pointerSegments(path: string): string[] | null {
	if (path === "/") {
		return [];
	}
	const segments = path.slice(1).split("/");
	const decoded = segments.map(decodePointerSegment);
	return decoded.every((segment): segment is string => segment !== null)
		? decoded
		: null;
}

function cloneJson(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(cloneJson);
	}
	if (isObject(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, cloneJson(entry)])
		);
	}
	return value;
}

function updateDataModel(
	current: unknown,
	path: string,
	value: unknown,
	hasValue: boolean,
	issues: string[]
): unknown {
	const segments = pointerSegments(path);
	if (!segments) {
		pushIssue(issues, "A2UI data model paths may not address prototype keys");
		return current;
	}
	if (segments.length === 0) {
		return hasValue ? cloneJson(value) : {};
	}

	const root = cloneJson(current);
	let cursor: unknown = root;
	if (!(Array.isArray(cursor) || isObject(cursor))) {
		cursor = {};
	}
	const rootValue = cursor;
	for (const [index, segment] of segments.entries()) {
		const last = index === segments.length - 1;
		if (Array.isArray(cursor)) {
			const arrayIndex = Number(segment);
			if (!Number.isInteger(arrayIndex) || arrayIndex < 0) {
				pushIssue(issues, `A2UI array path segment is invalid: ${segment}`);
				return current;
			}
			if (last) {
				if (hasValue) {
					cursor[arrayIndex] = cloneJson(value);
				} else {
					cursor.splice(arrayIndex, 1);
				}
				return rootValue;
			}
			if (
				!(Array.isArray(cursor[arrayIndex]) || isObject(cursor[arrayIndex]))
			) {
				cursor[arrayIndex] = {};
			}
			cursor = cursor[arrayIndex];
			continue;
		}
		if (!isObject(cursor)) {
			pushIssue(
				issues,
				"A2UI data model path does not address an object or array"
			);
			return current;
		}
		if (last) {
			if (hasValue) {
				cursor[segment] = cloneJson(value);
			} else {
				delete cursor[segment];
			}
			return rootValue;
		}
		if (!(Array.isArray(cursor[segment]) || isObject(cursor[segment]))) {
			cursor[segment] = {};
		}
		cursor = cursor[segment];
	}
	return rootValue;
}

function supportedCatalog(catalogId: string | undefined): boolean {
	return (
		catalogId === undefined ||
		(A2UI_BASIC_CATALOG_IDS as readonly string[]).includes(catalogId)
	);
}

function dynamicExpression(
	value: unknown,
	binding: boolean,
	issues: string[]
): unknown {
	if (!isObject(value)) {
		return value;
	}
	if (typeof value.literalString === "string") {
		return value.literalString;
	}
	if (typeof value.literalNumber === "number") {
		return value.literalNumber;
	}
	if (typeof value.literalBoolean === "boolean") {
		return value.literalBoolean;
	}
	if (Array.isArray(value.literalStringList)) {
		return value.literalStringList.filter(
			(entry): entry is string => typeof entry === "string"
		);
	}
	if (typeof value.path === "string") {
		if (!value.path.startsWith("/")) {
			pushIssue(
				issues,
				`A2UI relative data path is not supported: ${value.path}`
			);
			return undefined;
		}
		return binding ? { $bindState: value.path } : { $state: value.path };
	}
	if ("functionCall" in value) {
		pushIssue(issues, "A2UI functionCall expressions are not executed by Ryu");
		return undefined;
	}
	return Object.fromEntries(
		Object.entries(value)
			.map(([key, entry]) => [key, dynamicExpression(entry, false, issues)])
			.filter(([, entry]) => entry !== undefined)
	);
}

function childrenOf(component: A2uiComponent, issues: string[]): string[] {
	const children = component.children;
	if (Array.isArray(children)) {
		return children.filter(
			(child): child is string =>
				typeof child === "string" &&
				child.length > 0 &&
				child.length <= MAX_ID_LENGTH
		);
	}
	if (isObject(children)) {
		pushIssue(
			issues,
			`A2UI repeat/template children are not supported for ${component.component}`
		);
	}
	return [];
}

function textFromComponent(
	component: A2uiComponent | undefined,
	issues: string[]
): unknown {
	return component?.component === "Text"
		? dynamicExpression(component.text ?? "", false, issues)
		: undefined;
}

function actionFor(
	component: A2uiComponent,
	surfaceId: string,
	issues: string[]
): Record<string, unknown> | undefined {
	if (!isObject(component.action)) {
		return undefined;
	}
	if ("functionCall" in component.action) {
		pushIssue(
			issues,
			"A2UI local functionCall actions are not executed by Ryu"
		);
		return undefined;
	}
	const event = component.action.event;
	if (!isObject(event) || typeof event.name !== "string") {
		return undefined;
	}
	return {
		press: {
			action: "submit",
			params: {
				value: {
					protocol: "a2ui",
					name: event.name,
					surfaceId,
					context: dynamicExpression(event.context ?? {}, false, issues),
				},
			},
		},
	};
}

function alignValue(
	value: unknown
): "start" | "center" | "end" | "stretch" | undefined {
	return value === "start" ||
		value === "center" ||
		value === "end" ||
		value === "stretch"
		? value
		: undefined;
}

function justifyValue(
	value: unknown
): "start" | "center" | "end" | "between" | "around" | undefined {
	if (value === "start" || value === "center" || value === "end") {
		return value;
	}
	if (value === "spaceBetween") {
		return "between";
	}
	if (value === "spaceAround" || value === "spaceEvenly") {
		return "around";
	}
	return undefined;
}

function unsupportedElement(
	component: A2uiComponent,
	issues: string[]
): { type: string; props: Record<string, unknown>; children: string[] } {
	pushIssue(issues, `A2UI component is not mapped: ${component.component}`);
	return {
		type: "Alert",
		props: {
			title: "Unsupported A2UI component",
			description: component.component,
		},
		children: [],
	};
}

function mapComponent(
	component: A2uiComponent,
	components: Map<string, A2uiComponent>,
	surfaceId: string,
	issues: string[]
): {
	type: string;
	props: Record<string, unknown>;
	children: string[];
	on?: Record<string, unknown>;
} {
	const children = childrenOf(component, issues);
	const child =
		typeof component.child === "string" ? component.child : children[0];
	const on = actionFor(component, surfaceId, issues);
	const mapped = (
		type: string,
		props: Record<string, unknown>,
		nextChildren = children
	) => ({
		type,
		props,
		children: nextChildren,
		...(on ? { on } : {}),
	});

	switch (component.component) {
		case "Column":
			return mapped("Stack", {
				direction: "column",
				align: alignValue(component.align),
				justify: justifyValue(component.justify),
			});
		case "Row":
			return mapped("Stack", {
				direction: "row",
				align: alignValue(component.align),
				justify: justifyValue(component.justify),
			});
		case "List":
			return mapped("Stack", {
				direction: component.direction === "horizontal" ? "row" : "column",
				align: alignValue(component.align),
			});
		case "Card":
			return mapped("Card", {}, child ? [child] : []);
		case "Divider":
			return mapped(
				"Separator",
				{
					orientation:
						component.axis === "vertical" ? "vertical" : "horizontal",
				},
				[]
			);
		case "Text": {
			const text = dynamicExpression(component.text ?? "", false, issues);
			const variant = component.variant;
			if (
				variant === "h1" ||
				variant === "h2" ||
				variant === "h3" ||
				variant === "h4" ||
				variant === "h5"
			) {
				return mapped(
					"Heading",
					{
						text,
						level: variant === "h5" ? 4 : Number(variant.slice(1)),
					},
					[]
				);
			}
			return mapped(
				"Text",
				{
					text,
					size: variant === "caption" ? "xs" : "sm",
				},
				[]
			);
		}
		case "Image":
			return mapped(
				"Image",
				{
					src: dynamicExpression(component.url ?? "", false, issues),
					alt: dynamicExpression(component.description ?? "", false, issues),
				},
				[]
			);
		case "Link":
			return mapped(
				"Link",
				{
					text: dynamicExpression(
						component.text ?? component.title ?? "Open link",
						false,
						issues
					),
					href: dynamicExpression(
						component.url ?? component.href ?? "",
						false,
						issues
					),
				},
				[]
			);
		case "Button":
			return mapped(
				"Button",
				{
					label:
						textFromComponent(
							child ? components.get(child) : undefined,
							issues
						) ?? "Continue",
					variant:
						component.variant === "primary"
							? "default"
							: component.variant === "borderless"
								? "link"
								: "secondary",
				},
				[]
			);
		case "TextField": {
			const value = dynamicExpression(component.value ?? "", true, issues);
			const props = {
				label: dynamicExpression(component.label ?? "", false, issues),
				value,
			};
			if (component.variant === "longText") {
				return mapped("Textarea", props, []);
			}
			return mapped(
				"Input",
				{
					...props,
					type:
						component.variant === "number"
							? "number"
							: component.variant === "obscured"
								? "password"
								: "text",
				},
				[]
			);
		}
		case "CheckBox":
			return mapped(
				"Checkbox",
				{
					label: dynamicExpression(component.label ?? "", false, issues),
					checked: dynamicExpression(component.value ?? false, true, issues),
				},
				[]
			);
		case "ChoicePicker": {
			if (component.variant === "multipleSelection") {
				return unsupportedElement(component, issues);
			}
			const options = Array.isArray(component.options)
				? component.options.flatMap((option) => {
						if (!isObject(option) || typeof option.value !== "string") {
							return [];
						}
						return [
							{
								label: dynamicExpression(
									option.label ?? option.value,
									false,
									issues
								),
								value: option.value,
							},
						];
					})
				: [];
			return mapped(
				"OptionList",
				{
					label: dynamicExpression(component.label ?? "", false, issues),
					value: dynamicExpression(component.value ?? "", true, issues),
					options,
				},
				[]
			);
		}
		case "Slider":
			return mapped(
				"Slider",
				{
					label: dynamicExpression(component.label ?? "", false, issues),
					value: dynamicExpression(component.value ?? 0, true, issues),
					min: typeof component.min === "number" ? component.min : 0,
					max: typeof component.max === "number" ? component.max : 100,
				},
				[]
			);
		case "DateTimeInput":
			return mapped(
				"Input",
				{
					label: dynamicExpression(
						component.label ?? "Date and time",
						false,
						issues
					),
					value: dynamicExpression(component.value ?? "", true, issues),
					type: "text",
				},
				[]
			);
		default:
			return unsupportedElement(component, issues);
	}
}

function isSupportedRoot(elements: Record<string, unknown>): boolean {
	return Object.hasOwn(elements, "root");
}

/**
 * Convert a bounded A2UI v0.9/v0.9.1 message sequence into Ryu's native spec.
 *
 * This deliberately maps only the known A2UI basic catalog into the closed Ryu
 * catalog. It never downloads a catalog, evaluates a function call, or executes
 * HTML/JavaScript. Unsupported components remain visible as inert Alert nodes so
 * a foreign surface cannot crash or escape the native renderer.
 */
export function normalizeA2ui(input: unknown): A2uiNormalizationResult {
	const issues: string[] = [];
	const messages = parseInput(input, issues);
	let surface: SurfaceState | null = null;
	let sawMultipleSurfaces = false;

	for (const message of messages) {
		if (message.createSurface) {
			if (surface && surface.id !== message.createSurface.surfaceId) {
				sawMultipleSurfaces = true;
				pushIssue(
					issues,
					"Ryu Agent UI currently renders one A2UI surface per card"
				);
				continue;
			}
			surface = {
				catalogId: message.createSurface.catalogId,
				components: new Map(),
				dataModel: {},
				id: message.createSurface.surfaceId,
			};
			if (!supportedCatalog(surface.catalogId)) {
				pushIssue(issues, `Unsupported A2UI catalog: ${surface.catalogId}`);
			}
			continue;
		}

		if (message.deleteSurface) {
			if (surface?.id === message.deleteSurface.surfaceId) {
				surface = null;
			}
			continue;
		}

		if (message.updateComponents) {
			if (!surface) {
				pushIssue(issues, "A2UI updateComponents arrived before createSurface");
				continue;
			}
			if (surface.id !== message.updateComponents.surfaceId) {
				pushIssue(issues, "A2UI updateComponents targets another surface");
				continue;
			}
			for (const component of message.updateComponents.components) {
				if (
					surface.components.size >= MAX_COMPONENTS &&
					!surface.components.has(component.id)
				) {
					pushIssue(
						issues,
						`A2UI surfaces may contain at most ${MAX_COMPONENTS} components`
					);
					break;
				}
				surface.components.set(component.id, component);
			}
			continue;
		}

		if (message.updateDataModel) {
			if (!surface) {
				pushIssue(issues, "A2UI updateDataModel arrived before createSurface");
				continue;
			}
			if (surface.id !== message.updateDataModel.surfaceId) {
				pushIssue(issues, "A2UI updateDataModel targets another surface");
				continue;
			}
			surface.dataModel = updateDataModel(
				surface.dataModel,
				message.updateDataModel.path ?? "/",
				message.updateDataModel.value,
				Object.hasOwn(message.updateDataModel, "value"),
				issues
			);
		}
	}

	if (!surface) {
		return { issues, spec: null };
	}
	if (sawMultipleSurfaces) {
		return { issues, spec: null, surfaceId: surface.id };
	}
	if (!supportedCatalog(surface.catalogId)) {
		return { issues, spec: null, surfaceId: surface.id };
	}
	const rawElements: Record<string, unknown> = {};
	const mappedIds = new Set<string>();
	for (const [id, component] of surface.components) {
		rawElements[id] = mapComponent(
			component,
			surface.components,
			surface.id,
			issues
		);
		mappedIds.add(id);
	}
	if (!isSupportedRoot(rawElements)) {
		pushIssue(issues, "A2UI surface must define a component with id 'root'");
		return { issues, spec: null, surfaceId: surface.id };
	}

	const elements = Object.fromEntries(
		Object.entries(rawElements).map(([id, rawElement]) => {
			const element = rawElement as {
				children?: unknown;
				on?: Record<string, unknown>;
				props: Record<string, unknown>;
				type: string;
			};
			return [
				id,
				{
					...element,
					children: Array.isArray(element.children)
						? element.children.filter(
								(child): child is string =>
									typeof child === "string" && mappedIds.has(child)
							)
						: [],
				},
			];
		})
	) as AgentUiRenderSpec["elements"];

	const state = isObject(surface.dataModel)
		? (surface.dataModel as Record<string, unknown>)
		: { value: surface.dataModel };
	return {
		issues,
		spec: { root: "root", elements, state },
		surfaceId: surface.id,
	};
}
