// packages/marketplace/src/catalog/import-tools-action.tsx
//
// Shared by every surface that turns an integrations.sh directory record into
// real tools: the record-level Apps/Plugins catalog rows and the brand-level
// Integrations tab. It lives here rather than inside one section because both
// call the same two Core endpoints with the same success/error contract, and a
// second copy is how the two drift.

import { Download01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@ryu/ui/components/button.tsx";
import { useState } from "react";
import type { CatalogNode } from "./host.tsx";

/** Import an integrations.sh API entry (REST `openapi` or `graphql`) as
 *  gateway-governed `http` tools via the Core import endpoints. Core resolves +
 *  parses server-side and installs a disabled plugin (one tool per operation for
 *  REST, one query tool for GraphQL); the user enables it from Tools to activate. */
export default function ImportToolsAction({
	node,
	endpoint,
	body,
	label = "Install as tools",
	size = "sm",
}: {
	body: Record<string, unknown>;
	endpoint: string;
	/** Verb on the idle button, for surfaces that name the connection instead. */
	label?: string;
	node: CatalogNode;
	size?: "sm" | "default";
}) {
	const [state, setState] = useState<"idle" | "busy" | "done" | "error">(
		"idle"
	);
	const [message, setMessage] = useState<string | null>(null);

	const run = () => {
		setState("busy");
		setMessage(null);
		const base = node.url.replace(/\/$/, "");
		fetch(`${base}${endpoint}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(node.token ? { Authorization: `Bearer ${node.token}` } : {}),
			},
			body: JSON.stringify(body),
		})
			.then(async (res) => {
				const json = (await res.json().catch(() => ({}))) as {
					dropped?: number;
					error?: string;
					success?: boolean;
					tools?: number;
				};
				if (res.ok && json.success) {
					const dropped = json.dropped
						? ` (${json.dropped} more not imported)`
						: "";
					setMessage(
						`Installed ${json.tools ?? 0} tool${json.tools === 1 ? "" : "s"}${dropped}. Enable it from Tools to use them.`
					);
					setState("done");
				} else {
					setMessage(json.error ?? `HTTP ${res.status}`);
					setState("error");
				}
			})
			.catch((err: unknown) => {
				setMessage(err instanceof Error ? err.message : String(err));
				setState("error");
			});
	};

	if (state === "done") {
		return <p className="text-muted-foreground text-sm">{message}</p>;
	}
	return (
		<div className="flex flex-col gap-1">
			<Button disabled={state === "busy"} onClick={run} size={size}>
				<HugeiconsIcon className="size-4" icon={Download01Icon} />
				{state === "busy" ? "Installing…" : label}
			</Button>
			{state === "error" && message ? (
				<p className="text-destructive text-xs">{message}</p>
			) : null}
		</div>
	);
}
