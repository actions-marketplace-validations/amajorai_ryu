"use client";
import { Button } from "./button.tsx";
import {
	GHOST_AVATAR_VARIANTS,
	type GhostAvatarAppearance,
} from "./ghost-avatar.ts";
import { Input } from "./input.tsx";
import { LOGO_DEFAULT_COLORS } from "./logo-colors.ts";
import { NativeSelect } from "./native-select.tsx";
import { Switch } from "./switch.tsx";

export function GhostAvatarControls({
	value,
	onChange,
}: {
	value: GhostAvatarAppearance;
	onChange: (value: GhostAvatarAppearance) => void;
}) {
	const variant = value.variant ?? "outline";
	const defaultColors = {
		...LOGO_DEFAULT_COLORS,
		c1:
			variant === "outline-muted"
				? "var(--muted-foreground)"
				: variant === "outline" || variant === "expressive"
					? "currentColor"
					: LOGO_DEFAULT_COLORS.c1,
	};
	return (
		<div className="space-y-3">
			<div className="grid grid-cols-2 gap-3">
				<label className="space-y-1 text-xs">
					Appearance
					<NativeSelect
						aria-label="Avatar appearance"
						className="w-full"
						onChange={(event) => {
							const next = GHOST_AVATAR_VARIANTS.find(
								(item) => item === event.target.value
							);
							if (next) {
								onChange({ ...value, variant: next });
							}
						}}
						value={variant}
					>
						<option value="3d">3D ghost</option>
						<option value="outline">Outline</option>
						<option value="outline-muted">Muted outline</option>
						<option value="default">Orb</option>
						<option value="expressive">Expressive outline</option>
					</NativeSelect>
				</label>
				<label className="space-y-1 text-xs">
					Behavior
					<NativeSelect
						aria-label="Avatar behavior"
						className="w-full"
						onChange={(event) =>
							onChange({
								...value,
								behavior:
									event.target.value === "conversation"
										? "conversation"
										: "custom",
							})
						}
						value={value.behavior ?? "custom"}
					>
						<option value="custom">Choose expressions</option>
						<option value="conversation">Follow conversation</option>
					</NativeSelect>
				</label>
			</div>
			{value.behavior === "conversation" ? (
				<p className="text-muted-foreground text-xs">
					Reacts to thinking, replies, tool use, requests for input, and errors.
					Shows an idle face outside a conversation.
				</p>
			) : null}
			<div className="flex items-center justify-between gap-3">
				{variant === "3d" ? (
					<label className="flex items-center gap-2 text-xs">
						Body
						<NativeSelect
							aria-label="Avatar body style"
							onChange={(event) =>
								onChange({
									...value,
									bodyStyle: event.target.value === "solid" ? "solid" : "orb",
								})
							}
							value={value.bodyStyle ?? "orb"}
						>
							<option value="orb">Flowing colors</option>
							<option value="solid">Solid</option>
						</NativeSelect>
					</label>
				) : (
					<span />
				)}
				<label className="flex items-center gap-2 text-xs">
					Animate
					<Switch
						aria-label="Animate avatar"
						checked={value.animated !== false}
						onCheckedChange={(checked) =>
							onChange({ ...value, animated: checked })
						}
					/>
				</label>
			</div>
			<div className="flex items-center justify-between">
				<span className="font-medium text-xs">Colors</span>
				<Button
					onClick={() => onChange({ ...value, colors: undefined })}
					size="sm"
					type="button"
					variant="ghost"
				>
					Reset colors
				</Button>
			</div>
			<div className="grid grid-cols-2 gap-2">
				{(["bg", "c1", "c2", "c3"] as const).map((key, index) => (
					<label className="space-y-1 text-xs" key={key}>
						{key === "bg" ? "Base" : `Accent ${index}`}
						<div className="flex items-center gap-2">
							<span
								aria-hidden
								className="size-5 shrink-0 rounded-md border"
								style={{
									backgroundColor: value.colors?.[key] ?? defaultColors[key],
								}}
							/>
							<Input
								aria-label={`Avatar ${key === "bg" ? "base" : `accent ${index}`} color`}
								onChange={(event) =>
									onChange({
										...value,
										colors: { ...value.colors, [key]: event.target.value },
									})
								}
								value={value.colors?.[key] ?? defaultColors[key]}
							/>
						</div>
					</label>
				))}
			</div>
			<p className="text-muted-foreground text-xs">
				Outline styles use Accent 1. Colors accept hex, RGB, or OKLCH values.
			</p>
			<div className="grid grid-cols-2 gap-3">
				<label className="space-y-1 text-xs">
					Eye size
					<Input
						aria-label="Avatar eye size"
						max={3}
						min={0.25}
						onChange={(event) => {
							const next = event.target.valueAsNumber;
							if (Number.isFinite(next)) {
								onChange({
									...value,
									eyeScale: Math.max(0.25, Math.min(3, next)),
								});
							}
						}}
						step={0.25}
						type="number"
						value={value.eyeScale ?? (variant === "outline-muted" ? 1.5 : 1)}
					/>
				</label>
				<label className="space-y-1 text-xs">
					Color cycle (seconds)
					<Input
						aria-label="Avatar color cycle"
						max={120}
						min={1}
						onChange={(event) => {
							const next = event.target.valueAsNumber;
							if (Number.isFinite(next)) {
								onChange({
									...value,
									animationDuration: Math.max(1, Math.min(120, next)),
								});
							}
						}}
						type="number"
						value={value.animationDuration ?? 20}
					/>
				</label>
			</div>
		</div>
	);
}
