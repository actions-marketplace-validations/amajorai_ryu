import { Button } from "@ryu/ui/components/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@ryu/ui/components/card";
import { ArrowRight, Check, ExternalLink } from "lucide-react";
import type { ActivationTaskDraft } from "@/src/lib/onboarding-activation.ts";
import { ActivationStepShell } from "./ActivationStepShell.tsx";

function taskAppLabel(appName: string | null): string {
	return appName ?? "your connected apps";
}

export function ActivationTaskStep({
	draft,
	error,
	onStart,
	pending = false,
}: {
	draft: ActivationTaskDraft;
	error?: string | null;
	onStart: () => void;
	pending?: boolean;
}) {
	const appLabel = taskAppLabel(draft.appName);

	return (
		<ActivationStepShell
			subtitle="Your connected work is ready. Ryu will ask before it changes anything."
			title="Ryu is ready to start your first task"
		>
			<Card className="w-full max-w-2xl border border-border/60">
				<CardHeader>
					<div className="flex items-center gap-2 text-muted-foreground text-xs">
						<Check className="size-3.5 text-success" />
						Connected context ready
					</div>
					<CardTitle>{draft.title}</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="rounded-3xl bg-muted/60 p-5">
						<p className="whitespace-pre-wrap text-muted-foreground text-sm leading-6">
							{draft.prompt}
						</p>
					</div>
					<div className="mt-4 flex items-center gap-2 text-muted-foreground text-xs">
						<ExternalLink className="size-3.5" />
						Using {appLabel} as connected context.
					</div>
					<div className="mt-2 flex items-center gap-2 text-muted-foreground text-xs">
						<ExternalLink className="size-3.5" />
						Ryu lives where you already work — nothing to change.
					</div>
					{error ? (
						<p className="mt-3 text-destructive text-sm" role="alert">
							{error}
						</p>
					) : null}
				</CardContent>
				<CardFooter className="justify-end border-t">
					<Button disabled={pending} loading={pending} onClick={onStart}>
						Start task <ArrowRight className="size-4" />
					</Button>
				</CardFooter>
			</Card>
		</ActivationStepShell>
	);
}
