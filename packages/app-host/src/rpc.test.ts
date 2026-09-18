import { describe, expect, it } from "bun:test";
import {
	asModelCompleteArg,
	asRpcRequest,
	asSafeActionsRequestArg,
	assertGranted,
	type Capability,
	CapabilityError,
	createI18nHostServices,
	dispatchRpc,
	GRANT_CAPABILITY,
	type HostServices,
	METHOD_CAPABILITY,
} from "./rpc.ts";

const AGENTS = [{ id: "ryu", name: "Ryu" }];

function services(): HostServices {
	return {
		i18nSnapshot: () => ({
			direction: "ltr",
			locale: "en",
			packId: null,
			packName: null,
			packVersion: null,
		}),
		i18nTranslate: (input) => input.defaultMessage,
		listAgents: () => Promise.resolve(AGENTS),
		catalogSnapshot: () =>
			Promise.resolve({
				agents: [],
				apiTypes: [],
				current: {
					provider: "gateway",
					providerRouting: {},
					routing: "gateway",
				},
				hookEvents: [],
				hooks: [],
				plugins: [],
				providers: [],
				thinkingLevels: [],
				version: 1,
			}),
		catalogModels: (input) =>
			Promise.resolve({
				models: [{ id: `${input.providerId}/model` }],
				providerId: input.providerId,
				source: "test",
			}),
		chatListConversations: () =>
			Promise.resolve([
				{
					agent_id: "agent-1",
					created_at: 1,
					id: "conversation-1",
					message_count: 2,
					run_status: "running",
					title: "Build",
					updated_at: 2,
				},
			]),
		chatSend: ({ conversationId, text }) =>
			Promise.resolve({
				conversation_id: `${conversationId}:${text}`,
				status: "accepted" as const,
			}),
		registerRoute: () => Promise.resolve(null),
	};
}

const GRANTED = new Set<Capability>(["core.listAgents"]);
const NONE = new Set<Capability>();

describe("createI18nHostServices", () => {
	it("shares snapshots, fallback translation, and abortable subscriptions", async () => {
		const listeners = new Set<() => void>();
		const snapshot = {
			direction: "ltr" as const,
			locale: "en",
			packId: null,
			packName: null,
			packVersion: null,
		};
		const services = createI18nHostServices({
			getSnapshot: () => snapshot,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			t: (id, _values, fallback) => fallback ?? id,
		});
		expect(await services.i18nSnapshot?.()).toEqual(snapshot);
		expect(
			await services.i18nTranslate?.({
				defaultMessage: "Refresh",
				id: "app.refresh",
			})
		).toBe("Refresh");

		const updates: string[] = [];
		const controller = new AbortController();
		const subscription = services.i18nSubscribe?.(
			{},
			(value) => updates.push(value),
			controller.signal
		);
		expect(updates).toEqual([JSON.stringify(snapshot)]);
		expect(listeners.size).toBe(1);
		controller.abort();
		await subscription;
		expect(listeners.size).toBe(0);
	});
});

function errorContract(value: unknown): {
	code: unknown;
	message: string;
	name: string;
} | null {
	if (!(value instanceof Error)) {
		return null;
	}
	return {
		code: "code" in value ? value.code : null,
		message: value.message,
		name: value.name,
	};
}

describe("dispatchRpc capability gate", () => {
	it("Connect workflow mutation requires runstate and strips no caller identity overrides", async () => {
		let calls = 0;
		const svc: HostServices = {...services(),workflowsBindConnectTrigger: async input => { calls++; return input; }};
		const input = {id:"workflow-a",connectTriggerId:"00000000-0000-4000-8000-000000000001"};
		await expect(dispatchRpc("workflows.bindConnectTrigger",[input],new Set<Capability>(["workflows.catalogs"]),svc)).rejects.toThrow();
		expect(calls).toBe(0);
		await expect(dispatchRpc("workflows.bindConnectTrigger",[{...input,ownerUserId:"other"}],new Set<Capability>(["workflows.runstate"]),svc)).rejects.toThrow();
		expect(calls).toBe(0);
		await expect(dispatchRpc("workflows.bindConnectTrigger",[input],new Set<Capability>(["workflows.runstate"]),svc)).resolves.toEqual(input);
		expect(calls).toBe(1);
	});

	it("Connect workflow reads and removals use distinct existing grants", async () => {
		const svc: HostServices = {...services(),workflowsConnectBindings:async input => [input],workflowsRemoveConnectBinding:async()=>undefined};
		await expect(dispatchRpc("workflows.connectBindings",[{id:"workflow-a"}],new Set<Capability>(["workflows.catalogs"]),svc)).resolves.toEqual([{id:"workflow-a"}]);
		await expect(dispatchRpc("workflows.removeConnectBinding",[{id:"workflow-a",bindingId:"binding-a"}],new Set<Capability>(["workflows.catalogs"]),svc)).rejects.toThrow();
		await expect(dispatchRpc("workflows.removeConnectBinding",[{id:"workflow-a",bindingId:"binding-a"}],new Set<Capability>(["workflows.runstate"]),svc)).resolves.toBeUndefined();
	});

	it("Connect workflow reads reject caller-supplied identity selectors", async () => {
		let calls = 0;
		const svc: HostServices = {
			...services(),
			workflowsConnectBindings: async () => {
				calls++;
				return [];
			},
		};
		await expect(
			dispatchRpc(
				"workflows.connectBindings",
				[{ id: "workflow-a", ownerUserId: "other" }],
				new Set<Capability>(["workflows.catalogs"]),
				svc
			)
		).rejects.toThrow();
		expect(calls).toBe(0);
	});
	it("dispatches a granted method to its service", async () => {
		const result = await dispatchRpc(
			"core.listAgents",
			[],
			GRANTED,
			services()
		);
		expect(result).toEqual(AGENTS);
	});

	it("dispatches the shared catalog through the existing read-only grant", async () => {
		await expect(
			dispatchRpc("catalog.snapshot", [], GRANTED, services())
		).resolves.toMatchObject({ version: 1, providers: [], agents: [] });
	});

	it("discovers provider models through the shared catalog bridge", async () => {
		await expect(
			dispatchRpc(
				"catalog.models",
				[{ providerId: "openai" }],
				GRANTED,
				services()
			)
		).resolves.toEqual({
			models: [{ id: "openai/model" }],
			providerId: "openai",
			source: "test",
		});
	});

	it("dispatches the scoped NotifyUser recipient roster through the catalog grant", async () => {
		const catalogGrant = new Set<Capability>(["workflows.catalogs"]);
		const svc: HostServices = {
			...services(),
			workflowsNotifyTargets: () =>
				Promise.resolve([{ id: "user-ada", name: "Ada Lovelace" }]),
		};
		await expect(
			dispatchRpc("workflows.notifyTargets", [], catalogGrant, svc)
		).resolves.toEqual([{ id: "user-ada", name: "Ada Lovelace" }]);
	});

	it("dispatches Chat Broadcast list and send through the explicit grant", async () => {
		const chatGrant = new Set<Capability>(["chat.broadcast"]);
		await expect(
			dispatchRpc("chat.list", [], chatGrant, services())
		).resolves.toMatchObject([{ id: "conversation-1", run_status: "running" }]);
		await expect(
			dispatchRpc(
				"chat.send",
				[{ conversationId: "conversation-1", text: "Stop linting." }],
				chatGrant,
				services()
			)
		).resolves.toEqual({
			conversation_id: "conversation-1:Stop linting.",
			status: "accepted",
		});
	});

	it("dispatches Activity observability reads and gates provider-backed actions", async () => {
		const readGrant = new Set<Capability>(["activity.read"]);
		const runGrant = new Set<Capability>(["activity.run"]);
		const readServices: HostServices = {
			...services(),
			activityAudit: async (input) => ({
				entries: [],
				filter: input,
				reachable: true,
			}),
			activityTrace: async (input) => ({ spans: [], ...input }),
		};
		await expect(
			dispatchRpc("activity.audit", [{ limit: 100 }], readGrant, readServices)
		).resolves.toMatchObject({ reachable: true });
		await expect(
			dispatchRpc(
				"activity.trace",
				[{ run_id: "run-1" }],
				readGrant,
				readServices
			)
		).resolves.toMatchObject({ run_id: "run-1" });
		const maintenanceServices: HostServices = {
			...services(),
			activityPrune: async () => ({ deleted_rows: 3 }),
			activityScore: async (input) => ({ kind: "online_score", input }),
		};
		await expect(
			dispatchRpc("activity.prune", [], runGrant, maintenanceServices)
		).resolves.toEqual({ deleted_rows: 3 });
		await expect(
			dispatchRpc(
				"activity.score",
				[{ response: "completed" }],
				runGrant,
				maintenanceServices
			)
		).resolves.toMatchObject({ kind: "online_score" });

		let called = false;
		const runServices: HostServices = {
			...services(),
			activityRedteam: async (input) => {
				called = true;
				return input;
			},
		};
		await expect(
			dispatchRpc(
				"activity.redteam",
				[{ agent_id: "agent-1" }],
				runGrant,
				runServices
			)
		).resolves.toEqual({ agent_id: "agent-1" });
		expect(called).toBe(true);
		await expect(
			dispatchRpc(
				"activity.redteam",
				[{ agent_id: "agent-1" }],
				readGrant,
				runServices
			)
		).rejects.toBeInstanceOf(CapabilityError);
	});

	it("REJECTS a known method whose capability was not granted", async () => {
		await expect(
			dispatchRpc("core.listAgents", [], NONE, services())
		).rejects.toBeInstanceOf(CapabilityError);
	});

	it("REJECTS an unknown method even when all capabilities are granted", async () => {
		await expect(
			dispatchRpc("core.deleteEverything", [], GRANTED, services())
		).rejects.toBeInstanceOf(CapabilityError);
	});

	it("never invokes the service for an ungranted call", async () => {
		let called = false;
		const spy: HostServices = {
			listAgents: () => {
				called = true;
				return Promise.resolve(AGENTS);
			},
			registerRoute: () => Promise.resolve(null),
		};
		await expect(
			dispatchRpc("core.listAgents", [], NONE, spy)
		).rejects.toBeInstanceOf(CapabilityError);
		expect(called).toBe(false);
	});

	it("keeps unary dispatch denials identical to the shared streaming gate", async () => {
		for (const [method, capability] of Object.entries(METHOD_CAPABILITY)) {
			if (
				capability === "host.capabilities" ||
				capability === "i18n" ||
				method === "node.shareOrigins"
			) {
				continue;
			}
			let assertedError: unknown;
			try {
				assertGranted(method, NONE);
			} catch (error) {
				assertedError = error;
			}
			let dispatchedError: unknown;
			try {
				await dispatchRpc(method, [], NONE, services());
			} catch (error) {
				dispatchedError = error;
			}
			expect(errorContract(dispatchedError), method).toEqual(
				errorContract(assertedError)
			);
		}
	});
});

describe("model completion argument validation", () => {
	it("preserves an explicit provider lane without accepting non-string input", () => {
		expect(
			asModelCompleteArg({
				model: "gpt-5",
				prompt: "hello",
				provider: "openai",
			})
		).toEqual({ model: "gpt-5", prompt: "hello", provider: "openai" });
		expect(
			asModelCompleteArg({ prompt: "hello", provider: { id: "openai" } })
		).toBeNull();
	});

	it("trims and validates shared catalog discovery arguments", async () => {
		await expect(
			dispatchRpc(
				"catalog.models",
				[{ providerId: "  openai " }],
				GRANTED,
				services()
			)
		).resolves.toMatchObject({ providerId: "openai" });
		await expect(
			dispatchRpc("catalog.models", [{ providerId: "" }], GRANTED, services())
		).rejects.toMatchObject({ code: "invalid_args" });
	});
});

describe("Safe Actions fixed-mount bridge", () => {
	const SAFE_ACTIONS = new Set<Capability>(["safe-actions.manage"]);

	it("dispatches only a validated relative request when granted", async () => {
		let received: unknown;
		const svc: HostServices = {
			listAgents: () => Promise.resolve([]),
			registerRoute: () => Promise.resolve(null),
			safeActionsRequest: async (input) => {
				received = input;
				return { ok: true };
			},
		};
		expect(
			await dispatchRpc(
				"safeActions.request",
				[{ path: "/reviews/r-1/approve", method: "POST", body: {} }],
				SAFE_ACTIONS,
				svc
			)
		).toEqual({ ok: true });
		expect(received).toEqual({
			path: "/reviews/r-1/approve",
			method: "POST",
			body: {},
		});
	});

	it("rejects traversal, absolute, query, and unsupported methods", () => {
		for (const input of [
			{ path: "/../mcp/tools" },
			{ path: "/%2e%2e/mcp/tools" },
			{ path: "//evil.example/x" },
			{ path: "https://evil.example/x" },
			{ path: "/receipts?all=1" },
			{ path: "/policies", method: "PATCH" },
		]) {
			expect(asSafeActionsRequestArg(input)).toBeNull();
		}
	});

	it("never calls the service without the capability", async () => {
		let called = false;
		await expect(
			dispatchRpc("safeActions.request", [{ path: "/policies" }], NONE, {
				listAgents: () => Promise.resolve([]),
				registerRoute: () => Promise.resolve(null),
				safeActionsRequest: async () => {
					called = true;
				},
			})
		).rejects.toMatchObject({ code: "denied" });
		expect(called).toBe(false);
	});
});

describe("grant-mapping completeness invariant", () => {
	// `widget.state`, `ui.displayMode`, and `host.capabilities` are LOCAL host caps
	// added directly by the
	// widget host on mount (never Gateway-sourced), so they intentionally have no
	// grant-string mapping. Every OTHER capability a method gates MUST be unlockable
	// via some grant string in GRANT_CAPABILITY — otherwise the whole method family
	// is functionally dead: the Gateway-approved grant maps to nothing, the granted
	// set is empty, and every call is denied (the `timeline.read` regression).
	const LOCAL_HOST_CAPS = new Set<Capability>([
		"host.capabilities",
		"i18n",
		"node.shareOrigins",
		"widget.state",
		"ui.displayMode",
	]);

	it("every capability reachable from METHOD_CAPABILITY has a grant mapping", () => {
		const grantable = new Set<Capability>(Object.values(GRANT_CAPABILITY));
		const unmapped: Array<{ capability: Capability; methods: string[] }> = [];
		for (const capability of new Set(Object.values(METHOD_CAPABILITY))) {
			if (LOCAL_HOST_CAPS.has(capability) || grantable.has(capability)) {
				continue;
			}
			unmapped.push({
				capability,
				methods: Object.entries(METHOD_CAPABILITY)
					.filter(([, cap]) => cap === capability)
					.map(([method]) => method),
			});
		}
		expect(unmapped).toEqual([]);
	});
});

describe("node share-origin host method", () => {
	it("is local, argument-free, and secret-free", async () => {
		const origins = [
			{ origin: "http://192.168.1.20:7980", source: "active", reachable: true },
		] as const;
		await expect(
			dispatchRpc("node.shareOrigins", [], new Set(), {
				...services(),
				nodeShareOrigins: () => Promise.resolve([...origins]),
			})
		).resolves.toEqual(origins);
		await expect(
			dispatchRpc("node.shareOrigins", [{}], new Set(), {
				...services(),
				nodeShareOrigins: () => Promise.resolve([]),
			})
		).rejects.toThrow("takes no arguments");
	});
});

describe("asRpcRequest envelope validation", () => {
	it("accepts a well-formed request", () => {
		expect(
			asRpcRequest({
				kind: "ryu-plugin-rpc",
				id: 1,
				method: "core.listAgents",
				args: [],
			})
		).toEqual({
			kind: "ryu-plugin-rpc",
			id: 1,
			method: "core.listAgents",
			args: [],
		});
	});

	it("rejects payloads with the wrong kind", () => {
		expect(
			asRpcRequest({ kind: "other", id: 1, method: "x", args: [] })
		).toBeNull();
	});

	it("rejects payloads missing required fields", () => {
		expect(asRpcRequest({ kind: "ryu-plugin-rpc", id: 1 })).toBeNull();
		expect(asRpcRequest(null)).toBeNull();
		expect(asRpcRequest("nope")).toBeNull();
	});
});

describe("assistant bridge dispatch", () => {
	const ASSISTANT = new Set<Capability>(["assistant.context"]);

	it("routes each assistant method to its service when granted", async () => {
		const calls: string[] = [];
		const svc: HostServices = {
			listAgents: () => Promise.resolve([]),
			registerRoute: () => Promise.resolve(null),
			assistantPublishContext: async ({ items }) => {
				calls.push(`publish:${items.length}`);
			},
			assistantClearContext: async () => {
				calls.push("clear");
			},
			assistantRegisterSurface: async ({ label }) => {
				calls.push(`surface:${label}`);
			},
			assistantClearSurface: async () => {
				calls.push("clearSurface");
			},
			assistantOpen: async ({ prompt }) => {
				calls.push(`open:${prompt ?? ""}`);
			},
		};
		await dispatchRpc(
			"assistant.publishContext",
			[{ items: [{ id: "a", title: "T", text: "x" }] }],
			ASSISTANT,
			svc
		);
		await dispatchRpc("assistant.clearContext", [], ASSISTANT, svc);
		await dispatchRpc(
			"assistant.registerSurface",
			[{ label: "Board" }],
			ASSISTANT,
			svc
		);
		await dispatchRpc("assistant.clearSurface", [], ASSISTANT, svc);
		await dispatchRpc("assistant.open", [{ prompt: "why?" }], ASSISTANT, svc);
		expect(calls).toEqual([
			"publish:1",
			"clear",
			"surface:Board",
			"clearSurface",
			"open:why?",
		]);
	});

	it("REFUSES every assistant method without the grant, service untouched", async () => {
		let touched = false;
		const svc: HostServices = {
			listAgents: () => Promise.resolve([]),
			registerRoute: () => Promise.resolve(null),
			assistantPublishContext: async () => {
				touched = true;
			},
			assistantOpen: async () => {
				touched = true;
			},
		};
		for (const method of ["assistant.publishContext", "assistant.open"]) {
			await expect(
				dispatchRpc(method, [{ items: [] }], new Set<Capability>(), svc)
			).rejects.toBeInstanceOf(CapabilityError);
		}
		expect(touched).toBe(false);
	});
});
