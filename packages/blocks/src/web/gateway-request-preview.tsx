"use client";

import { Tabs, TabsList, TabsTrigger } from "@ryu/ui/components/tabs";
import { Check, LockKeyhole, UserRoundCheck } from "lucide-react";
import { useState } from "react";

const EXAMPLES = {
	read: {
		label: "Read",
		request: "Summarize the notes in the project folder.",
		tool: "Read project files",
		access: "Project folder only",
		review: "Not required for reading",
		decision: "Allowed",
		detail: "The agent can read the approved folder and prepare a summary.",
		Icon: Check,
	},
	send: {
		label: "Send",
		request: "Email the project update to the client.",
		tool: "Send email",
		access: "Drafting is allowed",
		review: "Required before sending",
		decision: "Needs your approval",
		detail:
			"The draft is ready. Sending waits for someone on your team to approve it.",
		Icon: UserRoundCheck,
	},
	delete: {
		label: "Delete",
		request: "Delete the source files after writing the summary.",
		tool: "Delete files",
		access: "Read-only project access",
		review: "Cannot override this access rule",
		decision: "Blocked",
		detail: "This agent has no permission to delete the source files.",
		Icon: LockKeyhole,
	},
} as const;

type ExampleKey = keyof typeof EXAMPLES;

export function GatewayRequestPreview() {
	const [selected, setSelected] = useState<ExampleKey>("send");
	const example = EXAMPLES[selected];
	return (
		<div
			className="w-full overflow-hidden bg-background"
			data-testid="gateway-request-preview"
		>
			<div className="flex flex-wrap items-center justify-between gap-4 bg-muted/50 px-6 py-4">
				<span className="font-medium text-sm">Policy example</span>
				<Tabs
					onValueChange={(value) => {
						if (value === "read" || value === "send" || value === "delete") {
							setSelected(value);
						}
					}}
					value={selected}
				>
					<TabsList>
						{Object.entries(EXAMPLES).map(([value, item]) => (
							<TabsTrigger key={value} value={value}>
								{item.label}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
			</div>
			<div className="grid md:grid-cols-2">
				<div className="space-y-8 p-6 md:p-8">
					<div>
						<p className="text-muted-foreground text-xs">Task</p>
						<p className="mt-3 font-medium text-lg leading-relaxed">
							{example.request}
						</p>
					</div>
					<dl className="space-y-5 text-sm">
						<div>
							<dt className="text-muted-foreground">Tool</dt>
							<dd className="mt-1">{example.tool}</dd>
						</div>
						<div>
							<dt className="text-muted-foreground">Access rule</dt>
							<dd className="mt-1">{example.access}</dd>
						</div>
						<div>
							<dt className="text-muted-foreground">Human review</dt>
							<dd className="mt-1">{example.review}</dd>
						</div>
					</dl>
				</div>
				<div
					aria-live="polite"
					className="flex flex-col justify-center bg-muted/30 p-6 md:p-10"
				>
					<example.Icon
						aria-hidden="true"
						className="mb-6 size-8 text-primary"
						strokeWidth={1.5}
					/>
					<p className="font-heading font-medium text-2xl tracking-tight">
						{example.decision}
					</p>
					<p className="mt-4 text-muted-foreground text-sm leading-relaxed">
						{example.detail}
					</p>
				</div>
			</div>
		</div>
	);
}
