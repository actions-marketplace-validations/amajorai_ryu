// apps/desktop/src/hooks/store-prefetch-keys.test.ts
//
// The Store warm-up (`useStorePrefetch`) and every catalog hook build their
// queries from ONE descriptor per query, so a prefetch cannot land under a key no
// hook reads. This pins the other half of that contract: the key PREFIXES, which
// the hooks' mutations invalidate by (`invalidateQueries({ queryKey: ["skills",
// "list", url] })`). A descriptor that reordered or renamed its prefix would keep
// compiling, keep prefetching, and silently stop being invalidated after an
// install — the list would go on showing "Install" for something already on disk.

import { describe, expect, test } from "bun:test";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import { agentCatalogQuery } from "./useAgentsCatalog.ts";
import {
	installedAppsQuery,
	pluginCatalogQuery,
	pluginSourcesQuery,
} from "./useAppsCatalog.ts";
import { integrationsListQuery } from "./useIntegrationsCatalog.ts";
import {
	mcpListQuery,
	mcpServersQuery,
	mcpSourcesQuery,
} from "./useMcpCatalog.ts";
import { MODEL_LIST_DEFAULTS, modelListQuery } from "./useModelCatalog.ts";
import {
	installedSkillsQuery,
	skillListQuery,
	skillSourcesQuery,
} from "./useSkillsCatalog.ts";

const TARGET: ApiTarget = {
	url: "http://127.0.0.1:8980",
	token: null,
	userJwt: null,
};

/** Every descriptor, with the prefix its hook's mutations invalidate by. */
const DESCRIPTORS: { key: readonly unknown[]; prefix: unknown[] }[] = [
	{
		key: skillSourcesQuery(TARGET).queryKey,
		prefix: ["skills", "sources", TARGET.url],
	},
	{
		key: skillListQuery(TARGET, {
			query: "",
			installedOnly: false,
			source: "skills-sh",
		}).queryKey,
		prefix: ["skills", "list", TARGET.url],
	},
	{
		key: installedSkillsQuery(TARGET).queryKey,
		prefix: ["skills", "installed", TARGET.url],
	},
	{
		key: mcpSourcesQuery(TARGET).queryKey,
		prefix: ["mcp", "sources", TARGET.url],
	},
	{
		key: mcpServersQuery(TARGET).queryKey,
		prefix: ["mcp", "servers", TARGET.url],
	},
	{
		key: mcpListQuery(TARGET, { query: "", source: "official" }).queryKey,
		prefix: ["mcp", "list", TARGET.url],
	},
	{
		key: pluginSourcesQuery(TARGET).queryKey,
		prefix: ["plugins", "sources", TARGET.url],
	},
	{
		key: installedAppsQuery(TARGET).queryKey,
		prefix: ["apps", "list", TARGET.url],
	},
	{
		key: pluginCatalogQuery(TARGET, { query: "", source: "all" }).queryKey,
		prefix: ["plugins", "catalog", TARGET.url],
	},
	{
		key: agentCatalogQuery(TARGET).queryKey,
		prefix: ["agents", "catalog", TARGET.url],
	},
	{
		key: integrationsListQuery(TARGET, { query: "" }).queryKey,
		prefix: ["integrations", "list", TARGET.url],
	},
	{
		key: modelListQuery(TARGET, {
			query: MODEL_LIST_DEFAULTS.query,
			sort: MODEL_LIST_DEFAULTS.sort,
			format: MODEL_LIST_DEFAULTS.format,
			installedOnly: MODEL_LIST_DEFAULTS.installedOnly,
			task: "",
			org: MODEL_LIST_DEFAULTS.org,
		}).queryKey,
		prefix: ["models", "list", TARGET.url],
	},
];

describe("store catalog query descriptors", () => {
	test("every key starts with the prefix its mutations invalidate by", () => {
		for (const { key, prefix } of DESCRIPTORS) {
			expect(key.slice(0, prefix.length)).toEqual(prefix);
		}
	});

	test("the node url is part of every key, so two nodes never share a cache", () => {
		const other: ApiTarget = {
			url: "http://192.168.1.9:8980",
			token: null,
			userJwt: null,
		};
		expect(skillSourcesQuery(other).queryKey).not.toEqual(
			skillSourcesQuery(TARGET).queryKey
		);
		expect(agentCatalogQuery(other).queryKey).not.toEqual(
			agentCatalogQuery(TARGET).queryKey
		);
	});

	test("list keys carry their facets, so filters do not collide", () => {
		expect(
			skillListQuery(TARGET, {
				query: "pdf",
				installedOnly: false,
				source: "skills-sh",
			}).queryKey
		).not.toEqual(
			skillListQuery(TARGET, {
				query: "",
				installedOnly: false,
				source: "skills-sh",
			}).queryKey
		);
		expect(
			pluginCatalogQuery(TARGET, {
				query: "",
				source: "all",
				origin: "community",
			}).queryKey
		).not.toEqual(
			pluginCatalogQuery(TARGET, { query: "", source: "all" }).queryKey
		);
	});
});
