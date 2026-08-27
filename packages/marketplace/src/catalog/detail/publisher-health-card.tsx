import {
	Alert02Icon,
	CheckmarkCircle02Icon,
	InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@ryu/ui/components/badge.tsx";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@ryu/ui/components/card.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";
import {
	calculatePublisherHealth,
	type PublisherHealthInput,
	type PublisherHealthSignal,
} from "./publisher-health.ts";

function signalIcon(signal: PublisherHealthSignal) {
	if (signal.status === "good") {
		return CheckmarkCircle02Icon;
	}
	if (signal.status === "warning") {
		return Alert02Icon;
	}
	return InformationCircleIcon;
}

/** Compact install-time health disclosure. The score summarizes observable
 * signals and deliberately says that it is not a guarantee. */
export function PublisherHealthCard({
	className,
	...input
}: PublisherHealthInput & { className?: string }) {
	const health = calculatePublisherHealth(input);
	return (
		<Card className={cn("bg-muted/20", className)}>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between gap-3">
					<CardTitle className="text-sm">Publisher health</CardTitle>
					<Badge
						variant={
							input.publisherTrust === "dotted" ? "outline" : "secondary"
						}
					>
						{health.score}/100
					</Badge>
				</div>
				<div
					aria-label={`Publisher health score ${health.score} out of 100`}
					aria-valuemax={100}
					aria-valuemin={0}
					aria-valuenow={health.score}
					className="h-1.5 overflow-hidden rounded-full bg-muted"
					role="progressbar"
				>
					<div
						className={cn(
							"h-full rounded-full transition-[width]",
							health.score >= 70
								? "bg-success"
								: health.score >= 40
									? "bg-warning"
									: "bg-destructive"
						)}
						style={{ width: `${health.score}%` }}
					/>
				</div>
				<p className="text-muted-foreground text-xs">
					Signals, not a guarantee. Check the permissions and source before
					installing.
				</p>
			</CardHeader>
			<CardContent className="grid gap-2 pt-0">
				{health.signals.map((signal) => (
					<div className="flex items-center gap-2 text-xs" key={signal.label}>
						<HugeiconsIcon
							className={cn(
								"size-3.5",
								signal.status === "good"
									? "text-success"
									: signal.status === "warning"
										? "text-warning"
										: "text-muted-foreground"
							)}
							icon={signalIcon(signal)}
						/>
						<span className="text-muted-foreground">{signal.label}</span>
						<span className="ml-auto text-right">{signal.value}</span>
					</div>
				))}
			</CardContent>
		</Card>
	);
}
