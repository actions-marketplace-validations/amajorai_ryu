# <img src="https://raw.githubusercontent.com/amajorai/ryu/main/.github/logo.png" width="50" align="middle" alt="" />&nbsp; Ryu Island

> The dynamic-island context companion overlay. Part of [Ryu](../../README.md).

[![License](https://shieldcn.dev/badge/License-Proprietary-71717A.svg)](./LICENSE)
[![Stack](https://shieldcn.dev/badge/Electron-TypeScript-47848F.svg?logo=electron&logoColor=white)](../../README.md)

A frameless, transparent, always-on-top Electron overlay that morphs between compact and expanded states and sits above any app. It watches the active app via Shadow (`:3030`), surfaces local-model proactive suggestions, and opens a mini chat onto Core (`:7980`), all behind an explicit per-capability consent gate. It embeds no agent loop: every model call goes to Core, all screen context comes from Shadow, and it degrades quietly when either is unreachable.

**Tier:** Closed, proprietary (A Major Pte. Ltd.)

## Stack

- Electron + electron-vite + React + Zustand
- Main-process Core/Shadow HTTP/SSE clients + typed `window.island` contextBridge
- Click-through frameless overlay, global hotkey, cross-platform packaging (electron-builder: `dist:win`/`dist:mac`/`dist:linux`)

## Develop

From the repo root:

```sh
bun run dev:island   # electron-vite dev with HMR
```

Needs Core on `:7980` (`bun run dev:core`); Shadow on `:3030` is optional (context/proactive report "unavailable" without it).

## What it does

- Morphing overlay with idle / context / suggestion / expanded states
- Local-model proactive suggestions driven by Shadow context loops
- Mini chat onto Core
- Expanded chat stays a single quiet card with a small header; attachments remain in the composer's `+` menu, while voice and the command palette keep their global shortcuts
- Command bar: the global hotkey expands the island into a command palette / mini-chat (the former standalone `apps/command` was merged in)
- Per-capability consent gate (chat / contextRead / proactive) enforced in the main process; no telemetry

## License

Proprietary. See [LICENSE](./LICENSE). © 2026 A Major Pte. Ltd.
