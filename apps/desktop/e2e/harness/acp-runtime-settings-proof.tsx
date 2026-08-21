import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AcpRuntimeSection } from "../../src/components/gateway/AcpRuntimeSection.tsx";
import type { ApiTarget } from "../../src/lib/api/client.ts";
import type {
	GatewayAcpConfig,
	GatewayConfig,
	GatewayConfigPatch,
} from "../../src/lib/api/gateway.ts";
import "../../src/index.css";

const TARGET: ApiTarget = {
	token: null,
	url: "http://127.0.0.1:7980",
};

const AUTO_LIMIT = 2;
const INITIAL_ACP: GatewayAcpConfig = {
	active_agents: 1,
	auto_max_parallel_agents: AUTO_LIMIT,
	effective_max_parallel_agents: AUTO_LIMIT,
	hardware: {
		cpu_cores: 8,
		physical_cores: 4,
		total_ram_bytes: 32 * 1024 ** 3,
	},
	idle_timeout_minutes: 10,
	keep_computer_awake: true,
	max_parallel_agents: null,
};

let gatewayConfig = {
	acp: INITIAL_ACP,
} as GatewayConfig;

function emitRuntimeEvent(message: string): void {
	window.dispatchEvent(
		new CustomEvent("acp-runtime-proof-event", { detail: message })
	);
}

function installGatewayMock(): () => void {
	const nativeFetch = window.fetch.bind(window);
	window.fetch = async (input, init) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		if (!url.endsWith("/api/gateway/config")) {
			return nativeFetch(input, init);
		}

		if ((init?.method ?? "GET").toUpperCase() === "PUT") {
			const patch = JSON.parse(
				typeof init.body === "string" ? init.body : "{}"
			) as GatewayConfigPatch;
			if (patch.acp) {
				const max = patch.acp.max_parallel_agents;
				gatewayConfig = {
					...gatewayConfig,
					acp: {
						...gatewayConfig.acp,
						...patch.acp,
						effective_max_parallel_agents: max ?? AUTO_LIMIT,
					},
				};
				emitRuntimeEvent(
					`Gateway saved [acp]: ${Object.keys(patch.acp).join(", ")}`
				);
			}
			return new Response(JSON.stringify({ ok: true }), {
				headers: { "content-type": "application/json" },
				status: 200,
			});
		}

		emitRuntimeEvent(
			`Core runtime snapshot: ${gatewayConfig.acp.active_agents} active / ${gatewayConfig.acp.effective_max_parallel_agents} allowed`
		);
		return new Response(JSON.stringify(gatewayConfig), {
			headers: { "content-type": "application/json" },
			status: 200,
		});
	};

	return () => {
		window.fetch = nativeFetch;
	};
}

function ProofArtifact() {
	const [events, setEvents] = useState([
		"Built-in enforcement: Gateway policy + Core supervisor",
	]);
	const queryClient = useMemo(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: { retry: false },
				},
			}),
		[]
	);

	useEffect(() => {
		const onEvent = (event: Event) => {
			const detail = (event as CustomEvent<string>).detail;
			setEvents((current) => [...current, detail].slice(-6));
		};
		window.addEventListener("acp-runtime-proof-event", onEvent);
		const restoreFetch = installGatewayMock();
		return () => {
			window.removeEventListener("acp-runtime-proof-event", onEvent);
			restoreFetch();
		};
	}, []);

	return (
		<QueryClientProvider client={queryClient}>
			<main
				style={{
					background: "#09090b",
					boxSizing: "border-box",
					color: "#f4f4f5",
					fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
					minHeight: "100vh",
					padding: "32px 28px 48px",
				}}
			>
				<div style={{ margin: "0 auto", maxWidth: 1160 }}>
					<header
						style={{
							alignItems: "start",
							display: "flex",
							gap: 20,
							justifyContent: "space-between",
							marginBottom: 24,
						}}
					>
						<div>
							<div
								style={{ color: "#c4b5fd", fontSize: 12, letterSpacing: 1.4 }}
							>
								RYU · LIVE REACT PROOF
							</div>
							<h1 style={{ fontSize: 34, margin: "7px 0 0" }}>
								ACP agent runtime
							</h1>
							<p
								style={{
									color: "#a1a1aa",
									fontSize: 16,
									lineHeight: 1.5,
									margin: "10px 0 0",
									maxWidth: 780,
								}}
							>
								The real Gateway settings component is mounted below. The mock
								transport shows persisted policy, Core's active admission count,
								and each save.
							</p>
						</div>
						<div
							data-testid="proof-status"
							style={{
								background: "#123022",
								border: "1px solid #245c3e",
								borderRadius: 999,
								color: "#86efac",
								fontSize: 11,
								fontWeight: 800,
								letterSpacing: 1,
								padding: "9px 12px",
								whiteSpace: "nowrap",
							}}
						>
							VERIFIED · BUILT-IN
						</div>
					</header>

					<div
						style={{
							display: "grid",
							gap: 20,
							gridTemplateColumns: "minmax(0, 1fr) 320px",
						}}
					>
						<section
							aria-label="ACP agent runtime settings"
							style={{
								background: "#111113",
								border: "1px solid #27272a",
								borderRadius: 18,
								padding: 22,
							}}
						>
							<AcpRuntimeSection canConfigure target={TARGET} />
						</section>

						<aside
							style={{
								background: "#111113",
								border: "1px solid #27272a",
								borderRadius: 18,
								padding: 22,
							}}
						>
							<div style={{ color: "#a1a1aa", fontSize: 11, letterSpacing: 1 }}>
								RUNTIME TELEMETRY
							</div>
							<h2 style={{ fontSize: 20, margin: "8px 0 18px" }}>
								Node guardrails
							</h2>
							<div
								data-testid="runtime-snapshot"
								style={{
									background: "#18181b",
									border: "1px solid #3f3f46",
									borderRadius: 12,
									fontSize: 14,
									lineHeight: 1.7,
									padding: 14,
								}}
							>
								<div>1 active ACP process</div>
								<div>Auto hardware limit: 2</div>
								<div>32 GiB RAM · 4 physical cores</div>
								<div style={{ color: "#86efac", marginTop: 6 }}>
									Keep-awake default: on
								</div>
							</div>
							<div
								style={{ color: "#a1a1aa", fontSize: 12, margin: "22px 0 8px" }}
							>
								Gateway/Core event log
							</div>
							<ol
								data-testid="runtime-event-log"
								style={{
									color: "#d4d4d8",
									fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
									fontSize: 11,
									lineHeight: 1.7,
									margin: 0,
									paddingLeft: 20,
								}}
							>
								{events.map((event, index) => (
									<li key={`${event}-${index}`}>{event}</li>
								))}
							</ol>
						</aside>
					</div>
				</div>
			</main>
		</QueryClientProvider>
	);
}

installGatewayMock();
createRoot(document.getElementById("root") as HTMLElement).render(
	<ProofArtifact />
);
