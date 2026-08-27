import { Button } from "@ryu/ui/components/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@ryu/ui/components/card";
import { Label } from "@ryu/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@ryu/ui/components/radio-group";
import { useState } from "react";
import {
	ONBOARDING_SOURCES,
	type OnboardingSource,
} from "@/src/lib/api/onboarding-activation.ts";
import { ActivationStepShell } from "./ActivationStepShell.tsx";

const SOURCE_LABELS: Readonly<Record<OnboardingSource, string>> = {
	community: "A community or event",
	friend: "A friend or colleague",
	newsletter: "A newsletter",
	other: "Somewhere else",
	podcast: "A podcast",
	search: "Search",
	social: "Social media",
	work: "My workplace",
	youtube: "YouTube",
};

export function AcquisitionSourceStep({
	busy = false,
	error,
	onContinue,
}: {
	busy?: boolean;
	error?: string | null;
	onContinue: (source: OnboardingSource) => void;
}) {
	const [source, setSource] = useState<OnboardingSource | null>(null);

	return (
		<ActivationStepShell
			subtitle="This helps us understand how people find Ryu."
			title="Where did you hear about us?"
		>
			<Card className="w-full max-w-xl border border-border/60">
				<CardHeader>
					<CardTitle>One quick question</CardTitle>
				</CardHeader>
				<CardContent>
					<RadioGroup
						aria-label="Where did you hear about us?"
						onValueChange={(value: unknown) => {
							if (
								typeof value === "string" &&
								(ONBOARDING_SOURCES as readonly string[]).includes(value)
							) {
								setSource(value as OnboardingSource);
							}
						}}
						value={source ?? ""}
					>
						{ONBOARDING_SOURCES.map((value) => {
							const id = `onboarding-source-${value}`;
							return (
								<div className="flex items-center gap-3" key={value}>
									<RadioGroupItem id={id} value={value} />
									<Label className="font-normal text-sm" htmlFor={id}>
										{SOURCE_LABELS[value]}
									</Label>
								</div>
							);
						})}
					</RadioGroup>
					{error ? (
						<p className="mt-4 text-destructive text-sm" role="alert">
							{error}
						</p>
					) : null}
				</CardContent>
				<CardFooter className="justify-end border-t">
					<Button
						disabled={busy || source === null}
						loading={busy}
						onClick={() => {
							if (source) {
								onContinue(source);
							}
						}}
					>
						Continue
					</Button>
				</CardFooter>
			</Card>
		</ActivationStepShell>
	);
}
