import { Button } from "@ryu/ui/components/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
} from "@ryu/ui/components/card";
import { Logo } from "@ryu/ui/components/logo";
import { PageHeader } from "@ryu/ui/components/page-header";
import { Spinner } from "@ryu/ui/components/spinner";
import { useCallback, useEffect, useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { WEB_URL } from "@/lib/app-urls.ts";
import { openExternal } from "@/lib/tauri-bridge.ts";
import Layout from "@/src/components/layout/Layout.tsx";
import { useCreditsWallet } from "@/src/hooks/useCreditsWallet.ts";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	defaultCloudAgentSelection,
	setLaneAgentSelection,
} from "@/src/lib/api/preferences.ts";
import { useNodeStore } from "@/src/store/useNodeStore.ts";
import {
	type BotManagedEntryState,
	resolveBotManagedEntryState,
} from "./bot-managed-entry-state.ts";

const PROVISIONING_POLL_MS = 5000;

function BotEntryCard({
	busy,
	onRetry,
	state,
}: {
	busy: boolean;
	onRetry: () => void;
	state: Exclude<BotManagedEntryState, "ready">;
}) {
	const subscribe = state === "subscribe";
	const checking = state === "checking-subscription";
	return (
		<Card className="w-full max-w-md border-border/70 shadow-xl">
			<CardHeader className="items-center gap-4 text-center">
				<Logo size="48px" variant="outline" />
				<PageHeader
					className="text-center [&>h1]:text-2xl [&>p]:text-base"
					stagger={false}
					subtitle={
						checking
							? "Checking your Ryu subscription."
							: subscribe
								? "A Ryu subscription includes your managed Bot workspace."
								: "Ryu is preparing your managed Bot workspace."
					}
					title="Ryu Bot"
				/>
			</CardHeader>
			<CardContent className="flex justify-center px-6 pb-6">
				{checking ? (
					<div className="flex items-center gap-2 text-muted-foreground text-sm">
						<Spinner /> Checking your subscription…
					</div>
				) : subscribe ? (
					<p className="max-w-sm text-center text-muted-foreground text-sm leading-relaxed">
						Subscribe once and Ryu manages the models, computer, and
						infrastructure for you. There is no provider setup in Ryu Bot.
					</p>
				) : (
					<div className="flex items-center gap-2 text-muted-foreground text-sm">
						<Spinner /> Preparing your managed workspace…
					</div>
				)}
			</CardContent>
			<CardFooter className="justify-center gap-2 border-border/60 border-t px-6 py-4">
				{subscribe ? (
					<Button
						data-testid="bot-subscribe"
						onClick={() => {
							openExternal(`${WEB_URL}/pricing`).catch(() => undefined);
						}}
					>
						Choose a subscription
					</Button>
				) : (
					<Button
						data-testid="bot-retry"
						disabled={busy}
						onClick={onRetry}
						variant="outline"
					>
						{busy ? <Spinner /> : null}
						Refresh workspace
					</Button>
				)}
			</CardFooter>
		</Card>
	);
}

/**
 * Account-only Bot entry point. It adopts the user's existing managed node and
 * writes the shared cloud-lane default; it never provisions a node, handles a
 * credential, or changes the runtime's authorization gates from the client.
 */
export function BotManagedEntry() {
	const {
		entitlement,
		loading: resolvingSubscription,
		refresh,
	} = useCreditsWallet();
	const hydrateCloudNodes = useNodeStore((state) => state.hydrateCloudNodes);
	const managedNode = useNodeStore((state) =>
		state.cloudNodes.find((node) => node.managed)
	);
	const [state, setState] = useState<BotManagedEntryState>(
		"checking-subscription"
	);
	const [busy, setBusy] = useState(false);

	const adoptManagedWorkspace = useCallback(async () => {
		if (resolvingSubscription || !entitlement?.managedInference) {
			return;
		}
		setBusy(true);
		setState("provisioning");
		await hydrateCloudNodes().catch(() => undefined);
		const node = useNodeStore
			.getState()
			.cloudNodes.find((candidate) => candidate.managed);
		if (!node) {
			setBusy(false);
			return;
		}

		// Bot adopts the managed node in memory only. The Build product owns the
		// user's durable local-node list; writing a cloud node into that file would
		// make a zero-setup product mutate the power-user product's configuration.
		useNodeStore.setState((current) => ({
			defaultNode: node.name,
			nodes: current.nodes.some((candidate) => candidate.name === node.name)
				? current.nodes
				: [...current.nodes, node],
		}));
		// This is the existing shared managed provider seam. Bot does not expose a
		// picker, BYOK key, or routing toggle; it simply selects the subscription
		// default that Core/Gateway already understand.
		await setLaneAgentSelection(
			toTarget(node),
			"cloud",
			defaultCloudAgentSelection(true)
		).catch(() => false);
		setBusy(false);
		setState("ready");
	}, [entitlement?.managedInference, hydrateCloudNodes, resolvingSubscription]);

	useEffect(() => {
		const next = resolveBotManagedEntryState({
			hasManagedNode: managedNode !== undefined,
			managedInference: entitlement?.managedInference === true,
			resolvingSubscription,
		});
		setState(next);
		if (next === "provisioning") {
			adoptManagedWorkspace().catch(() => {
				setBusy(false);
				setState("provisioning");
			});
		}
	}, [
		adoptManagedWorkspace,
		entitlement?.managedInference,
		managedNode,
		resolvingSubscription,
	]);

	useEffect(() => {
		if (state !== "provisioning" || !entitlement?.managedInference) {
			return;
		}
		const timer = setInterval(() => {
			adoptManagedWorkspace().catch(() => undefined);
		}, PROVISIONING_POLL_MS);
		return () => clearInterval(timer);
	}, [adoptManagedWorkspace, entitlement?.managedInference, state]);

	if (state === "ready") {
		return (
			<MemoryRouter initialEntries={["/chat"]}>
				<Routes>
					<Route element={<Layout />} path="/*" />
				</Routes>
			</MemoryRouter>
		);
	}

	return (
		<div
			className="flex size-full items-center justify-center p-6"
			data-product="ryu-bot"
			data-testid="bot-managed-entry"
		>
			<BotEntryCard
				busy={busy}
				onRetry={() => {
					if (state === "subscribe") {
						refresh().catch(() => undefined);
						return;
					}
					adoptManagedWorkspace().catch(() => undefined);
				}}
				state={state}
			/>
		</div>
	);
}
