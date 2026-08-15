"use client";

import {
	AiBrain01Icon,
	AudioWave01Icon,
	DollarCircleIcon,
	FlashIcon,
	Image01Icon,
	Pdf01Icon,
	TextFontIcon,
	Video01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@ryu/ui/lib/utils";
import type { ModelInsight } from "@/src/lib/api/model-insight.ts";

type Modality = "text" | "image" | "pdf" | "video" | "audio";

const MODALITY_META: Record<Modality, { icon: IconSvgElement; label: string }> =
	{
		text: { icon: TextFontIcon, label: "Text" },
		image: { icon: Image01Icon, label: "Image" },
		pdf: { icon: Pdf01Icon, label: "PDF" },
		video: { icon: Video01Icon, label: "Video" },
		audio: { icon: AudioWave01Icon, label: "Audio" },
	};

const KNOWN_MODALITIES = new Set<string>(Object.keys(MODALITY_META));

const BAR_PIPS = [1, 2, 3, 4, 5] as const;

function formatTokens(n: number): string {
	if (n >= 1_000_000) {
		const m = n / 1_000_000;
		return `${Number.isInteger(m) ? m.toFixed(0) : m.toFixed(1)}M`;
	}
	if (n >= 1000) {
		const k = n / 1000;
		return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}K`;
	}
	return String(n);
}

function formatUsdPer1m(n: number): string {
	if (n < 0.01) {
		return `$${n.toFixed(4)}`;
	}
	if (n < 1) {
		return `$${n.toFixed(3)}`;
	}
	return `$${n.toFixed(2)}`;
}

function barTone(score: number): string {
	if (score >= 4) {
		return "bg-success";
	}
	if (score >= 3) {
		return "bg-foreground/55";
	}
	return "bg-warning";
}

function ScoreBar({
	label,
	score,
	hint,
}: {
	label: string;
	score: number | null | undefined;
	hint?: string | null;
}) {
	const value = typeof score === "number" && score >= 1 ? score : null;
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<div className="flex items-baseline justify-between gap-2">
				<span className="text-[11px] text-muted-foreground">{label}</span>
				{hint ? (
					<span className="truncate text-[10px] text-muted-foreground/80">
						{hint}
					</span>
				) : null}
			</div>
			<span
				aria-label={
					value === null ? `${label}: unknown` : `${label}: ${value} of 5`
				}
				className="flex items-center gap-0.5"
				role="img"
			>
				{BAR_PIPS.map((level) => (
					<span
						className={cn(
							"h-2 w-3 rounded-sm",
							value !== null && level <= value
								? barTone(value)
								: "bg-muted-foreground/20"
						)}
						key={level}
					/>
				))}
			</span>
		</div>
	);
}

function ModalityRow({
	inputs,
	outputs,
}: {
	inputs: string[];
	outputs: string[];
}) {
	const inMods = inputs.filter((m): m is Modality => KNOWN_MODALITIES.has(m));
	const outMods = outputs.filter((m): m is Modality => KNOWN_MODALITIES.has(m));
	if (inMods.length === 0 && outMods.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<span className="text-[11px] text-muted-foreground">Modalities</span>
			<div className="flex flex-wrap items-center gap-1">
				{inMods.map((m) => (
					<span
						className="inline-flex items-center gap-1 rounded-md bg-foreground/8 px-1.5 py-0.5 text-[10px] text-foreground/80"
						key={`in-${m}`}
						title={MODALITY_META[m].label}
					>
						<HugeiconsIcon className="size-3" icon={MODALITY_META[m].icon} />
						{MODALITY_META[m].label}
					</span>
				))}
				<span className="text-[10px] text-muted-foreground">→</span>
				{outMods.map((m) => (
					<span
						className="inline-flex items-center gap-1 rounded-md bg-foreground/8 px-1.5 py-0.5 text-[10px] text-foreground/80"
						key={`out-${m}`}
						title={MODALITY_META[m].label}
					>
						<HugeiconsIcon className="size-3" icon={MODALITY_META[m].icon} />
						{MODALITY_META[m].label}
					</span>
				))}
			</div>
		</div>
	);
}

/**
 * Compact model insight card for the agent/model picker hover.
 * 2×2 score bars (speed / cost / intelligence / context) plus price,
 * context tokens, and modality chips — filled from Core's insight cascade.
 */
export function ModelHoverPreview({ insight }: { insight: ModelInsight }) {
	const inputPrice =
		typeof insight.costInputPer1m === "number"
			? formatUsdPer1m(insight.costInputPer1m)
			: null;
	const outputPrice =
		typeof insight.costOutputPer1m === "number"
			? formatUsdPer1m(insight.costOutputPer1m)
			: null;
	const contextHint =
		typeof insight.contextTokens === "number"
			? formatTokens(insight.contextTokens)
			: null;
	const speedHint =
		typeof insight.outputTokensPerSecond === "number"
			? `${Math.round(insight.outputTokensPerSecond)} tok/s`
			: null;
	const intelHint =
		typeof insight.intelligenceIndex === "number"
			? insight.intelligenceIndex.toFixed(0)
			: null;
	const costHint =
		inputPrice && outputPrice
			? `${inputPrice} / ${outputPrice}`
			: (inputPrice ?? outputPrice);

	return (
		<div className="flex w-[16.5rem] flex-col gap-3">
			<div className="flex flex-col gap-0.5">
				<div className="flex items-start gap-2">
					<HugeiconsIcon
						className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
						icon={AiBrain01Icon}
					/>
					<div className="min-w-0 flex-1">
						<p className="truncate font-medium text-[13px] leading-tight">
							{insight.name}
						</p>
						{insight.description ? (
							<p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground leading-snug">
								{insight.description}
							</p>
						) : null}
					</div>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
				<ScoreBar hint={speedHint} label="Speed" score={insight.scoreSpeed} />
				<ScoreBar hint={costHint} label="Cost" score={insight.scoreCost} />
				<ScoreBar
					hint={intelHint}
					label="Intelligence"
					score={insight.scoreIntelligence}
				/>
				<ScoreBar
					hint={contextHint}
					label="Context"
					score={insight.scoreContext}
				/>
			</div>

			{(inputPrice || outputPrice || contextHint) && (
				<div className="flex flex-col gap-1 border-border/40 border-t pt-2">
					{(inputPrice || outputPrice) && (
						<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
							<HugeiconsIcon
								className="size-3 shrink-0"
								icon={DollarCircleIcon}
							/>
							<span className="font-heading tabular-nums">
								{inputPrice ? (
									<>
										In {inputPrice}
										<span className="text-muted-foreground/70"> /1M</span>
									</>
								) : null}
								{inputPrice && outputPrice ? " · " : null}
								{outputPrice ? (
									<>
										Out {outputPrice}
										<span className="text-muted-foreground/70"> /1M</span>
									</>
								) : null}
							</span>
						</div>
					)}
					{contextHint ? (
						<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
							<HugeiconsIcon className="size-3 shrink-0" icon={FlashIcon} />
							<span>
								{contextHint} context
								{typeof insight.maxOutputTokens === "number"
									? ` · ${formatTokens(insight.maxOutputTokens)} out`
									: null}
							</span>
						</div>
					) : null}
				</div>
			)}

			<ModalityRow
				inputs={insight.modalitiesInput}
				outputs={insight.modalitiesOutput}
			/>

			<p className="text-[10px] text-muted-foreground/70">
				via {insight.source}
				{insight.aaMatchedName ? ` · AA: ${insight.aaMatchedName}` : null}
			</p>
		</div>
	);
}
