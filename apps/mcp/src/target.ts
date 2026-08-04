// Build a single ApiTarget for the running Ryu Core node from the environment.
//
// RYU_CORE_URL  - base URL of the Core node (default http://127.0.0.1:7980)
// RYU_CORE_TOKEN - optional bearer token; pass null (no header) when unset
//
// The token now falls back to the one Core mints at `<ryu_home>/node-auth.token`
// (see `resolveLocalNodeToken`). Core authenticates its local API by default, so
// an MCP server launched by hand — not spawned by Core, and therefore not
// inheriting `RYU_TOKEN` — would otherwise 401 on every call.

import type { ApiTarget } from "@ryuhq/core-client/client";
import { resolveLocalNodeToken } from "@ryuhq/core-client/node-token";

const DEFAULT_CORE_URL = "http://127.0.0.1:7980";

export const buildTarget = (): ApiTarget => {
	const url = process.env.RYU_CORE_URL?.trim() || DEFAULT_CORE_URL;
	// The URL is passed so the MINTED token is only ever sent to a local Core:
	// `RYU_CORE_URL` can point anywhere, and this machine's node secret must not
	// travel to a remote host.
	return { url, token: resolveLocalNodeToken(url) };
};
