import { queryOptions } from "@tanstack/react-query";
import type { ApiTarget } from "./api/client.ts";
import { fetchGatewayConfig } from "./api/gateway.ts";

/** Shared settings reads belong to the node credentials that authorized them. */
export function gatewayAcpQueryOptions(target: ApiTarget) {
	return queryOptions({
		queryKey: [
			"gateway-acp-runtime",
			target.url,
			target.token ?? null,
			target.userJwt ?? null,
		],
		queryFn: ({ signal }) => fetchGatewayConfig(target, signal),
		refetchOnWindowFocus: false,
	});
}
