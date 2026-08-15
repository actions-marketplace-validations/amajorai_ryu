# <img src="https://raw.githubusercontent.com/amajorai/ryu/main/.github/logo.png" width="50" align="middle" alt="" />&nbsp; @ryuhq/sdk

> Ryu's own developer SDK for authoring agents, workflows, tools, and skills. Part of [Ryu](../../README.md).

[![License](https://shieldcn.dev/badge/License-Apache--2.0-73DC8C.svg?logo=apache&logoColor=white)](./LICENSE)
[![Stack](https://shieldcn.dev/badge/TypeScript-SDK-3178C6.svg?logo=typescript&logoColor=white)](../../README.md)

`@ryuhq/sdk` provides typed Runnable factories (`agent`, `workflow`, `tool`, `skill` plus their builders), a gateway-mandatory model client so every model call routes through the Ryu Gateway, an MCP server/client, and a `ryu` CLI for packing and publishing plugin bundles. It is Runnable-native: reference the AI SDK / Mastra / ACP patterns, but depend on none of them. The native logic ships through a prebuilt addon, `@ryuhq/sdk-native` (the `crates/sdk/napi` binding).

**Tier:** OSS (Apache-2.0)

## Install / Build

```bash
bun add @ryuhq/sdk
# build from source
bun run build   # tsup → dist/
bun test
```

## What it provides

- **Runnable factories:** `agent`, `workflow`, `tool`, `skill` (and `AgentBuilder` / `WorkflowBuilder` / `ToolBuilder` / `SkillBuilder` / `PluginBuilder`) for the one Runnable contract (input to run to output).
- **Manifest model:** `PluginManifest` types + `PluginManifestSchema` / `validateManifestStrict` / `validatePluginId` (also exported from `@ryuhq/sdk/manifest`).
- **Gateway-mandatory model client:** chat types and a client where every model call routes through the Ryu Gateway (also from `@ryuhq/sdk/model`).
- **MCP server/client:** author (`McpServer`) and consume (`listTools` / `callTool`) MCP tool surfaces, via `@ryuhq/sdk/mcp`, `@ryuhq/sdk/mcp/server`, or `@ryuhq/sdk/mcp/client`.
- **Plugin host surface:** `RyuPlugin` / `PluginContext` / `definePlugin` types for the desktop companion host, via `@ryuhq/sdk/plugin`.
- **Runnables + builders as entries:** `@ryuhq/sdk/runnable` (the four kinds and their factories) and `@ryuhq/sdk/builder`.
- **CLI:** `bunx ryu pack <dir>` (and `ryu publish`) via the package `bin` entry.

## Managing a running node

`@ryuhq/sdk` is the *authoring* SDK — it builds, packs, and publishes plugin
bundles and runs Runnables in-process. If you want to **drive a running Ryu
node programmatically** (install/enable/disable plugins, manage agents, models,
skills, MCP servers, spaces, workflows, gateway config, chat against Core),
that surface lives in [`@ryuhq/core-client`](../../packages/core-client) — the
same client the desktop app, TUI, and CLI run on — plus `@ryuhq/client` for
embedded agent chat. Nothing here duplicates it; `@ryuhq/sdk` deliberately
stays the authoring layer.

## License

Apache-2.0. See [LICENSE](./LICENSE). © 2026 A Major Pte. Ltd.
