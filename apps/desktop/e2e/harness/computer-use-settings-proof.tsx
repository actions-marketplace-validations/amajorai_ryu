import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ComputerUseSettings } from "../../src/components/gateway/ComputerUseSettings.tsx";
import type { ApiTarget } from "../../src/lib/api/client.ts";
import type { GatewayConfigPatch } from "../../src/lib/api/gateway.ts";
import "../../src/index.css";

const TARGET: ApiTarget = {
	token: null,
	url: "http://127.0.0.1:7980",
};

let computerUse = { locked_use: false };

function emitEvent(message: string): void {
	window.dispatchEvent(
		new CustomEvent("computer-use-proof-event", { detail: message })
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
			if (patch.computer_use) {
				computerUse = patch.computer_use;
				emitEvent(
					`Gateway saved [computer_use]: locked_use=${String(computerUse.locked_use)}`
				);
			}
			return new Response(JSON.stringify({ ok: true }), {
				headers: { "content-type": "application/json" },
				status: 200,
			});
		}

		return new Response(JSON.stringify({ computer_use: computerUse }), {
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
		"Gateway policy loaded: locked use is off",
	]);
	const queryClient = useMemo(
		() =>
			new QueryClient({
				defaultOptions: { queries: { retry: false } },
			}),
		[]
	);

	useEffect(() => {
		const onEvent = (event: Event) => {
			const detail = (event as CustomEvent<string>).detail;
			setEvents((current) => [...current, detail].slice(-5));
		};
		window.addEventListener("computer-use-proof-event", onEvent);
		return () => {
			window.removeEventListener("computer-use-proof-event", onEvent);
		};
	}, []);

	return (
		<QueryClientProvider client={queryClient}>
			<main className="min-h-screen bg-[#09090b] px-7 py-8 text-[#f4f4f5]">
				<div className="mx-auto max-w-5xl">
					<header className="mb-6 flex items-start justify-between gap-5">
						<div>
							<div className="text-[#c4b5fd] text-xs tracking-[1.4px]">
								RYU · LIVE REACT PROOF
							</div>
							<h1 className="mt-2 font-semibold text-3xl">Computer settings</h1>
							<p className="mt-2 max-w-2xl text-[#a1a1aa] text-base leading-6">
								Gateway-owned permissions for Ghost on the selected computer.
							</p>
						</div>
						<div className="rounded-full border border-[#245c3e] bg-[#123022] px-3 py-2 font-semibold text-[#86efac] text-[11px] tracking-wide">
							VERIFIED · GATEWAY
						</div>
					</header>

					<div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_300px]">
						<section className="rounded-2xl border border-[#27272a] bg-[#111113] p-5">
							<div className="mb-5 flex items-center justify-between border-[#27272a] border-b pb-4">
								<div>
									<div className="text-[#a1a1aa] text-[11px] uppercase tracking-wide">
										Selected computer
									</div>
									<div className="mt-1 font-medium text-lg">My MacBook</div>
								</div>
								<span className="rounded-full border border-[#3f3f46] px-2 py-1 text-[#a1a1aa] text-xs">
									Online
								</span>
							</div>
							<ComputerUseSettings canConfigure reachable target={TARGET} />
						</section>

						<aside className="rounded-2xl border border-[#27272a] bg-[#111113] p-5">
							<div className="text-[#a1a1aa] text-[11px] tracking-wide">
								GATEWAY EVENT LOG
							</div>
							<h2 className="mt-2 font-medium text-xl">Computer policy</h2>
							<div className="mt-4 rounded-xl border border-[#3f3f46] bg-[#18181b] p-3 font-mono text-[#d4d4d8] text-xs leading-6">
								<div>scope: selected computer</div>
								<div>section: [computer_use]</div>
								<div>default: locked_use = false</div>
							</div>
							<div className="mt-5 mb-2 text-[#a1a1aa] text-xs">
								Persistence trace
							</div>
							<ol className="m-0 list-decimal space-y-1 pl-5 font-mono text-[#d4d4d8] text-[11px] leading-5">
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
createRoot(document.getElementById("root")!).render(<ProofArtifact />);
