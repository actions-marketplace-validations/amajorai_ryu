"use client";

import { Switch } from "@ryu/ui/components/switch";
import { Tabs, TabsList, TabsTrigger } from "@ryu/ui/components/tabs";
import {
	ArrowDown,
	Github,
	Laptop,
	Mail,
	MessageSquare,
	NotebookPen,
	Server,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { GatewayRequestPreview } from "./gateway-request-preview.tsx";
import { SectionTitle } from "./section-title.tsx";

const TOOLS = [
	{ name: "Gmail", scope: "Create drafts", Icon: Mail },
	{ name: "Slack", scope: "Read selected channels", Icon: MessageSquare },
	{ name: "Notion", scope: "Read project documents", Icon: NotebookPen },
	{ name: "GitHub", scope: "Read issues", Icon: Github },
] as const;

function ToolAccessPreview() {
	const [enabled, setEnabled] = useState<string[]>(["Gmail", "Notion"]);
	const [model, setModel] = useState("Claude");
	return (
		<div className="bg-background p-6 md:p-8" data-testid="tool-access-preview">
			<div className="flex items-center justify-between gap-4">
				<span className="font-medium">Client follow-up</span>
				<span className="text-muted-foreground text-xs">Example agent</span>
			</div>
			<Tabs className="mt-6" onValueChange={setModel} value={model}>
				<TabsList>
					{["Claude", "ChatGPT", "Local"].map((name) => (
						<TabsTrigger key={name} value={name}>
							{name}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>
			<div className="mt-8 space-y-3">
				{TOOLS.map(({ name, scope, Icon }) => (
					<div className="flex items-center gap-4 bg-muted/40 p-4" key={name}>
						<Icon
							aria-hidden="true"
							className="size-5 shrink-0 text-primary"
							strokeWidth={1.5}
						/>
						<div className="min-w-0 flex-1">
							<label
								className="font-medium text-sm"
								htmlFor={`preview-tool-${name}`}
							>
								{name}
							</label>
							<p className="mt-1 text-muted-foreground text-xs">{scope}</p>
						</div>
						<Switch
							checked={enabled.includes(name)}
							id={`preview-tool-${name}`}
							onCheckedChange={(checked) =>
								setEnabled((current) =>
									checked
										? [...current, name]
										: current.filter((item) => item !== name)
								)
							}
						/>
					</div>
				))}
			</div>
			<p aria-live="polite" className="mt-6 text-muted-foreground text-sm">
				{enabled.length} tools available to {model}
			</p>
		</div>
	);
}

function DeploymentPreview() {
	const [mode, setMode] = useState("cloud");
	const hosted = mode === "cloud";
	return (
		<div className="bg-background p-6 md:p-8" data-testid="deployment-preview">
			<div className="flex flex-wrap items-center justify-between gap-4">
				<span className="font-medium">Deployment</span>
				<span className="text-muted-foreground text-xs">Example setup</span>
			</div>
			<Tabs className="mt-6" onValueChange={setMode} value={mode}>
				<TabsList>
					<TabsTrigger value="cloud">Ryu Cloud</TabsTrigger>
					<TabsTrigger value="self-hosted">Self-hosted</TabsTrigger>
				</TabsList>
			</Tabs>
			<div className="mt-8 flex flex-col items-center gap-4">
				<div className="flex w-full items-center gap-4 bg-muted/40 p-4">
					<Laptop aria-hidden="true" className="size-6 text-muted-foreground" />
					<div>
						<p className="text-sm">Your team</p>
						<p className="mt-1 text-muted-foreground text-xs">
							Browser, desktop, or chat
						</p>
					</div>
				</div>
				<ArrowDown
					aria-hidden="true"
					className="size-5 text-muted-foreground"
				/>
				<div className="w-full bg-primary/5 p-6">
					<div className="flex items-center gap-3">
						<Server aria-hidden="true" className="size-6 text-primary" />
						<span className="font-medium">
							{hosted ? "Ryu Cloud" : "Your server"}
						</span>
					</div>
					<div className="mt-5 grid grid-cols-3 gap-2">
						{["Agents", "Tools", "Workflows"].map((name) => (
							<span
								className="bg-background px-2 py-3 text-center text-xs"
								key={name}
							>
								{name}
							</span>
						))}
					</div>
				</div>
			</div>
			<div aria-live="polite" className="mt-6 grid grid-cols-2 gap-4 text-sm">
				<div>
					<p className="text-muted-foreground text-xs">Infrastructure</p>
					<p className="mt-1">
						{hosted ? "Managed by Ryu" : "Managed by your team"}
					</p>
				</div>
				<div>
					<p className="text-muted-foreground text-xs">Access and approvals</p>
					<p className="mt-1">Set by your team</p>
				</div>
			</div>
		</div>
	);
}

export function HomeCapabilitySections() {
	return (
		<>
			<section
				className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 md:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20"
				id="integration-layer"
			>
				<div>
					<SectionTitle title="Connect the tools your agent needs" />
					<p className="mt-5 max-w-md text-muted-foreground leading-relaxed">
						Use your models and subscriptions. Give each agent access to the
						tools and files its task needs.
					</p>
					<Link
						className="mt-6 inline-block text-sm underline underline-offset-4"
						href="/products/connections"
					>
						Explore connections
					</Link>
				</div>
				<div className="bg-muted/40 p-4 md:p-8" data-product-visual>
					<ToolAccessPreview />
				</div>
			</section>
			<section
				className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 md:py-24 lg:grid-cols-[1.2fr_0.8fr] lg:gap-20"
				id="agent-controls"
			>
				<div className="lg:order-2">
					<SectionTitle title="Decide what happens without you" />
					<p className="mt-5 max-w-md text-muted-foreground leading-relaxed">
						Allow routine reads, review outgoing work, and block actions an
						agent should never take.
					</p>
					<Link
						className="mt-6 inline-block text-sm underline underline-offset-4"
						href="/products/gateway"
					>
						Explore Gateway
					</Link>
				</div>
				<div className="bg-muted/40 p-4 md:p-8" data-product-visual>
					<GatewayRequestPreview />
				</div>
			</section>
			<section
				className="bg-muted/30"
				data-testid="managed-deployment"
				id="managed-deployment"
			>
				<div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 md:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
					<div>
						<SectionTitle title="Run it when your laptop is closed" />
						<p className="mt-5 max-w-md text-muted-foreground leading-relaxed">
							We manage the cloud deployment, or your team hosts the runtime.
							Your agents use the access rules you set.
						</p>
						<Link
							className="mt-6 inline-block text-sm underline underline-offset-4"
							href="/console"
						>
							See Ryu Console
						</Link>
					</div>
					<div className="bg-muted/40 p-4 md:p-8" data-product-visual>
						<DeploymentPreview />
					</div>
				</div>
			</section>
		</>
	);
}
