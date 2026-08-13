import { describe, expect, it } from "bun:test";
import {
	type AcpConfigOption,
	type AcpSelectionStore,
	type AcpSessionConfig,
	buildConfigOptionSection,
	buildModelSection,
	deriveVisibleAcpOptions,
	flattenConfigOptions,
	formatAcpOptionLabel,
	isApprovalConfigOption,
	isReasoningOption,
	mergeStreamedConfig,
	persistStreamedConfig,
	seedAcpSelections,
	shouldAdoptStreamedConfig,
} from "./composer-acp-sections.ts";

// An in-memory stand-in for each surface's localStorage-backed persistence, so
// the state machine's per-agent isolation is assertable without a DOM.
function fakeStore(): AcpSelectionStore & {
	config: Record<string, Record<string, string>>;
	mode: Record<string, string>;
	model: Record<string, string>;
} {
	const mode: Record<string, string> = {};
	const model: Record<string, string> = {};
	const config: Record<string, Record<string, string>> = {};
	return {
		mode,
		model,
		config,
		getAcpMode: (agentId) => (agentId ? (mode[agentId] ?? null) : null),
		getAcpModel: (agentId) => (agentId ? (model[agentId] ?? null) : null),
		getAcpConfig: (agentId) => (agentId ? (config[agentId] ?? {}) : {}),
		setAcpMode: (agentId, modeId) => {
			mode[agentId] = modeId;
		},
		setAcpModel: (agentId, modelId) => {
			model[agentId] = modelId;
		},
		setAcpConfigValue: (agentId, configId, valueId) => {
			config[agentId] = { ...(config[agentId] ?? {}), [configId]: valueId };
		},
	};
}

function option(partial: Partial<AcpConfigOption> & { id: string }) {
	return { name: partial.id, ...partial } satisfies AcpConfigOption;
}

describe("flattenConfigOptions", () => {
	it("returns an empty list for a missing or empty option set", () => {
		expect(flattenConfigOptions(option({ id: "a" }))).toEqual([]);
		expect(flattenConfigOptions(option({ id: "a", options: [] }))).toEqual([]);
	});

	it("passes an ungrouped list through", () => {
		const opts = [
			{ value: "low", name: "Low" },
			{ value: "high", name: "High" },
		];
		expect(flattenConfigOptions(option({ id: "a", options: opts }))).toEqual(
			opts
		);
	});

	it("flattens the grouped form", () => {
		expect(
			flattenConfigOptions(
				option({
					id: "a",
					options: [
						{ options: [{ value: "1", name: "One" }] },
						{ options: [{ value: "2", name: "Two" }] },
					],
				})
			)
		).toEqual([
			{ value: "1", name: "One" },
			{ value: "2", name: "Two" },
		]);
	});
});

describe("formatAcpOptionLabel", () => {
	it("strips a redundant option-name prefix and capitalizes", () => {
		expect(formatAcpOptionLabel("Thinking", "Thinking: off")).toBe("Off");
	});

	it("matches the prefix case-insensitively", () => {
		expect(formatAcpOptionLabel("Thinking", "thinking: high")).toBe("High");
	});

	it("leaves an unprefixed value alone but still capitalizes", () => {
		expect(formatAcpOptionLabel("Thinking", "medium")).toBe("Medium");
	});

	it("returns an empty label unchanged rather than throwing", () => {
		expect(formatAcpOptionLabel("Thinking", "Thinking:")).toBe("");
		expect(formatAcpOptionLabel("Thinking", "   ")).toBe("");
	});
});

describe("isApprovalConfigOption", () => {
	it("classifies the mode category", () => {
		expect(isApprovalConfigOption(option({ id: "x", category: "mode" }))).toBe(
			true
		);
	});

	it.each([
		"approval",
		"permission",
		"sandbox",
		"access",
	])("classifies %p in the id/name", (word) => {
		expect(isApprovalConfigOption(option({ id: `cfg.${word}` }))).toBe(true);
		expect(
			isApprovalConfigOption(option({ id: "cfg", name: `Tool ${word}` }))
		).toBe(true);
	});

	it("leaves an unrelated option plain", () => {
		expect(
			isApprovalConfigOption(option({ id: "verbosity", name: "Verbosity" }))
		).toBe(false);
	});
});

describe("isReasoningOption", () => {
	it.each([
		"thought",
		"reason",
		"think",
		"effort",
	])("classifies %p anywhere in category/id/name", (word) => {
		expect(isReasoningOption(option({ id: `cfg.${word}` }))).toBe(true);
		expect(isReasoningOption(option({ id: "cfg", category: word }))).toBe(true);
	});

	it("leaves an unrelated option alone", () => {
		expect(
			isReasoningOption(option({ id: "ryu.plan", name: "Plan mode" }))
		).toBe(false);
	});

	// Captured verbatim from opencode 1.18.5 over ACP (`session/set_config_option`
	// response, after selecting a model that has effort levels). Pinned because
	// that agent was reported as having no effort selector: the classifier was
	// never the gap — the option simply never reached it, since opencode omits it
	// from `session/new` until a model with effort levels is applied.
	it("classifies opencode's effort option, and renders it as the slider", () => {
		const openCodeEffort = {
			id: "effort",
			name: "Effort",
			description: "Available effort levels for this model",
			category: "thought_level",
			type: "select",
			currentValue: "low",
			options: [
				{ value: "low", name: "Low" },
				{ value: "medium", name: "Medium" },
				{ value: "high", name: "High" },
				{ value: "xhigh", name: "Xhigh" },
			],
		};
		expect(isReasoningOption(openCodeEffort)).toBe(true);
		const section = buildConfigOptionSection(
			openCodeEffort,
			{},
			() => undefined
		);
		expect(section.variant).toBe("slider");
		expect(section.items.map((i) => i.id)).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
		]);
		expect(section.value).toBe("low");
	});
});

describe("buildConfigOptionSection", () => {
	const thinking = option({
		id: "thought_level",
		name: "Thinking",
		currentValue: "low",
		options: [
			{ value: "low", name: "Thinking: low" },
			{ value: "high", name: "Thinking: high" },
		],
	});

	it("keys, labels and formats the rows", () => {
		const section = buildConfigOptionSection(thinking, {}, () => undefined);
		expect(section.key).toBe("cfg-thought_level");
		expect(section.label).toBe("Thinking");
		expect(section.items.map((i) => i.name)).toEqual(["Low", "High"]);
	});

	it("prefers a live selection over the agent's currentValue", () => {
		expect(buildConfigOptionSection(thinking, {}, () => undefined).value).toBe(
			"low"
		);
		expect(
			buildConfigOptionSection(
				thinking,
				{ thought_level: "high" },
				() => undefined
			).value
		).toBe("high");
	});

	it("reports the option id alongside the picked value", () => {
		const seen: string[] = [];
		const section = buildConfigOptionSection(
			thinking,
			{},
			(configId, valueId) => seen.push(`${configId}=${valueId}`)
		);
		section.onChange("high");
		expect(seen).toEqual(["thought_level=high"]);
	});

	it("decorates approval-ish options only", () => {
		expect(
			buildConfigOptionSection(thinking, {}, () => undefined).decorate
		).toBeUndefined();
		expect(
			buildConfigOptionSection(
				option({ id: "approval_policy", category: "mode" }),
				{},
				() => undefined
			).decorate
		).toBeDefined();
	});
});

describe("buildModelSection", () => {
	const base = {
		acpModelConfigOption: undefined,
		acpOptionValues: {},
		acpSessionConfig: null,
		activeAgentIsAcp: false,
		effectiveAcpModel: null,
		engineModel: null,
		filterModelItems: (items: { id: string; name: string }[]) => items,
		hasDedicatedAcpModels: false,
		modelDisplayName: (raw: string) => raw,
		modelOptions: [],
		onAcpModelChange: () => undefined,
		onAcpOptionChange: () => undefined,
		onEngineModelChange: () => undefined,
	};

	it("prefers the dedicated ACP model set", () => {
		const section = buildModelSection({
			...base,
			hasDedicatedAcpModels: true,
			effectiveAcpModel: "opus",
			acpSessionConfig: {
				configOptions: null,
				modes: null,
				models: {
					currentModelId: "opus",
					availableModels: [{ modelId: "opus", name: "Opus" }],
				},
			},
		});
		expect(section.items).toEqual([{ id: "opus", name: "Opus" }]);
		expect(section.value).toBe("opus");
	});

	it("falls back to a category:model config option", () => {
		const section = buildModelSection({
			...base,
			activeAgentIsAcp: true,
			acpModelConfigOption: option({
				id: "model",
				category: "model",
				currentValue: "gpt-5",
				options: [{ value: "gpt-5", name: "GPT-5" }],
			}),
		});
		expect(section.value).toBe("gpt-5");
		expect(section.items).toEqual([
			{ id: "gpt-5", name: "GPT-5", description: undefined },
		]);
	});

	it("falls back to the engine catalog only for a non-ACP agent", () => {
		const section = buildModelSection({
			...base,
			engineModel: "gemma",
			modelOptions: [{ id: "gemma", name: "Gemma" }],
		});
		expect(section.value).toBe("gemma");
		expect(
			buildModelSection({
				...base,
				activeAgentIsAcp: true,
				engineModel: "gemma",
				modelOptions: [{ id: "gemma", name: "Gemma" }],
			}).items
		).toEqual([]);
	});

	it("applies the display-name map and the per-branch filter", () => {
		const section = buildModelSection({
			...base,
			engineModel: "b",
			modelOptions: [
				{ id: "a", name: "a" },
				{ id: "b", name: "b" },
			],
			modelDisplayName: (raw) => raw.toUpperCase(),
			// A filter that hides everything still has to keep the branch's current
			// selection, or a hidden-but-selected model vanishes from under the user.
			filterModelItems: (items, current) =>
				items.filter((i) => i.id === current),
		});
		expect(section.items).toEqual([{ id: "b", name: "B" }]);
	});
});

describe("deriveVisibleAcpOptions", () => {
	const modes: AcpSessionConfig["modes"] = {
		currentModeId: "low",
		availableModes: [
			{ id: "low", name: "Low" },
			{ id: "high", name: "High" },
		],
	};

	it("hides the modes picker when a category:mode option exists", () => {
		const derived = deriveVisibleAcpOptions(
			{
				modes,
				models: null,
				configOptions: [option({ id: "approval", category: "mode" })],
			},
			false
		);
		expect(derived.hideAcpModesPicker).toBe(true);
	});

	it("hides the modes picker when a config option duplicates its value set", () => {
		const derived = deriveVisibleAcpOptions(
			{
				modes,
				models: null,
				configOptions: [
					option({
						id: "thought_level",
						options: [
							{ value: "high", name: "High" },
							{ value: "low", name: "Low" },
						],
					}),
				],
			},
			false
		);
		expect(derived.hideAcpModesPicker).toBe(true);
	});

	it("keeps the modes picker when nothing supersedes it", () => {
		const derived = deriveVisibleAcpOptions(
			{
				modes,
				models: null,
				configOptions: [
					option({
						id: "verbosity",
						options: [{ value: "terse", name: "Terse" }],
					}),
				],
			},
			false
		);
		expect(derived.hideAcpModesPicker).toBe(false);
	});

	it("routes a category:model option to the Model picker, not its own section", () => {
		const derived = deriveVisibleAcpOptions(
			{
				modes: null,
				models: null,
				configOptions: [option({ id: "model", category: "model" })],
			},
			false
		);
		expect(derived.acpModelConfigOption?.id).toBe("model");
		expect(derived.visibleAcpConfigOptions).toEqual([]);
	});

	it("suppresses the reasoning option only when reasoning is off", () => {
		const config: AcpSessionConfig = {
			modes: null,
			models: null,
			configOptions: [
				option({ id: "thought_level", name: "Thinking" }),
				option({ id: "verbosity", name: "Verbosity" }),
			],
		};
		expect(
			deriveVisibleAcpOptions(config, false).visibleAcpConfigOptions.map(
				(o) => o.id
			)
		).toEqual(["thought_level", "verbosity"]);
		expect(
			deriveVisibleAcpOptions(config, true).visibleAcpConfigOptions.map(
				(o) => o.id
			)
		).toEqual(["verbosity"]);
	});

	it("tolerates an absent config", () => {
		expect(deriveVisibleAcpOptions(null, false)).toEqual({
			acpModelConfigOption: undefined,
			hideAcpModesPicker: false,
			visibleAcpConfigOptions: [],
		});
	});
});

describe("shouldAdoptStreamedConfig", () => {
	const PLAN_OFF = { "ryu.plan": "off" };

	it("adopts the first write-back", () => {
		expect(
			shouldAdoptStreamedConfig({ config: PLAN_OFF, key: "m1:3" }, null)
		).toBe(true);
	});

	it("ignores a re-render of the SAME emission", () => {
		// The producer re-derives a fresh object on every stream chunk; only the
		// emission key stays stable, and that is what must gate adoption.
		expect(
			shouldAdoptStreamedConfig(
				{ config: { ...PLAN_OFF }, key: "m1:3" },
				"m1:3"
			)
		).toBe(false);
	});

	it("adopts a REPEATED, byte-identical config map under a new emission key", () => {
		// The bug this channel exists to fix: `ExitPlanMode` always writes
		// `{"ryu.plan":"off"}`, so a second plan cycle in one conversation re-emits
		// exactly the same pairs. A value-keyed guard swallows it and the Plan mode
		// pill stays armed — the agent then refuses the edits just approved.
		expect(
			shouldAdoptStreamedConfig(
				{ config: { ...PLAN_OFF }, key: "m7:1" },
				"m1:3"
			)
		).toBe(true);
	});

	it("ignores an absent write-back", () => {
		expect(shouldAdoptStreamedConfig(null, null)).toBe(false);
		expect(shouldAdoptStreamedConfig(undefined, "m1:3")).toBe(false);
	});
});

describe("mergeStreamedConfig", () => {
	it("merges over the current selections instead of replacing them", () => {
		// The map also carries every other advertised option; replacing it would
		// silently drop the user's thinking-effort pick.
		expect(
			mergeStreamedConfig(
				{ thought_level: "high", "ryu.plan": "on" },
				{ "ryu.plan": "off" }
			)
		).toEqual({ thought_level: "high", "ryu.plan": "off" });
	});

	it("does not mutate the previous map", () => {
		const prev = { thought_level: "high" };
		mergeStreamedConfig(prev, { "ryu.plan": "off" });
		expect(prev).toEqual({ thought_level: "high" });
	});
});

describe("per-agent isolation", () => {
	it("seeds each agent from its own persisted selections", () => {
		const store = fakeStore();
		store.setAcpMode("pi", "plan");
		store.setAcpModel("pi", "opus");
		store.setAcpConfigValue("pi", "thought_level", "high");
		store.setAcpMode("codex", "read-only");

		expect(seedAcpSelections(store, "pi")).toEqual({
			mode: "plan",
			model: "opus",
			options: { thought_level: "high" },
		});
		expect(seedAcpSelections(store, "codex")).toEqual({
			mode: "read-only",
			model: null,
			options: {},
		});
		expect(seedAcpSelections(store, null)).toEqual({
			mode: null,
			model: null,
			options: {},
		});
	});

	it("writes a streamed config back to the named agent only", () => {
		const store = fakeStore();
		store.setAcpConfigValue("codex", "ryu.plan", "on");
		persistStreamedConfig(store, "pi", { "ryu.plan": "off" });

		expect(store.getAcpConfig("pi")).toEqual({ "ryu.plan": "off" });
		// The agent that was NOT the write-back's target keeps its own pick — the
		// clobber that an agentId-keyed effect dep would reintroduce.
		expect(store.getAcpConfig("codex")).toEqual({ "ryu.plan": "on" });
	});

	it("merges a write-back into an agent's existing selections", () => {
		const store = fakeStore();
		store.setAcpConfigValue("pi", "thought_level", "high");
		persistStreamedConfig(store, "pi", { "ryu.plan": "off" });
		expect(store.getAcpConfig("pi")).toEqual({
			thought_level: "high",
			"ryu.plan": "off",
		});
	});

	it("persists nothing when no agent is selected", () => {
		const store = fakeStore();
		persistStreamedConfig(store, null, { "ryu.plan": "off" });
		expect(store.config).toEqual({});
	});
});
