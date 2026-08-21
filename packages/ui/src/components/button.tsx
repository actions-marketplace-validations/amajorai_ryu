import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cn } from "@ryu/ui/lib/utils.ts";
import { cva, type VariantProps } from "class-variance-authority";
import {
	FadeOverflowText,
	FadeOverflowTextChildren,
} from "./fade-overflow-text.tsx";
import { Spinner } from "./spinner.tsx";

const buttonVariants = cva(
	"group/button inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-4xl border border-transparent bg-clip-padding font-medium text-sm outline-none transition-all focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-primary/80",
				mono: "bg-foreground text-background hover:bg-foreground/90",
				outline:
					"border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-input/30",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
				ghost:
					"hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
				"ghost-muted":
					"text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
				destructive:
					"bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 dark:hover:bg-destructive/30",
				link: "text-primary underline-offset-4 hover:underline",
				loading:
					"relative bg-primary text-primary-foreground hover:bg-primary/80",
				progress:
					"relative overflow-hidden bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
			},
			size: {
				default:
					"h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
				xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
				sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
				lg: "h-14 gap-2 px-6 has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5",
				icon: "size-9",
				"icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-8",
				"icon-lg": "size-10",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	}
);

type ButtonProps = ButtonPrimitive.Props &
	VariantProps<typeof buttonVariants> & {
		/**
		 * Fill percentage (0–100) for the `progress` variant. The button's
		 * background doubles as a progress track, filling from the inline-start
		 * edge to this value. Ignored by every other variant.
		 */
		progress?: number;
		/** Render the shared loading indicator and make the button unavailable. */
		loading?: boolean;
	};

function ButtonLabel({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<FadeOverflowText className={cn("min-w-0 max-w-full", className)}>
			{children}
		</FadeOverflowText>
	);
}

function Button({
	className,
	variant = "default",
	size = "default",
	progress,
	loading = false,
	disabled,
	"aria-busy": ariaBusy,
	children,
	...props
}: ButtonProps) {
	const isLoading = loading || variant === "loading";
	const classNameWithLoading = cn(
		buttonVariants({ variant, size, className }),
		isLoading && "relative"
	);
	const buttonStateProps = {
		"aria-busy": isLoading ? true : ariaBusy,
		disabled: isLoading || disabled,
	};
	const loadingIndicator = isLoading ? (
		<Spinner className="pointer-events-none absolute end-1.5 top-1.5 size-3" />
	) : null;

	if (variant === "progress") {
		const value = Math.min(100, Math.max(0, progress ?? 0));

		return (
			<ButtonPrimitive
				aria-valuemax={100}
				aria-valuemin={0}
				aria-valuenow={value}
				className={classNameWithLoading}
				data-slot="button"
				role="progressbar"
				{...props}
				{...buttonStateProps}
			>
				<span
					aria-hidden="true"
					className="absolute inset-y-0 start-0 bg-[color-mix(in_oklch,var(--secondary-foreground),transparent_85%)] transition-[width] duration-300 ease-out"
					data-slot="button-progress-fill"
					style={{ width: `${value}%` }}
				/>
				<span className="relative inline-flex items-center justify-center gap-1.5">
					<FadeOverflowTextChildren>{children}</FadeOverflowTextChildren>
				</span>
				{loadingIndicator}
			</ButtonPrimitive>
		);
	}

	return (
		<ButtonPrimitive
			className={classNameWithLoading}
			data-slot="button"
			{...props}
			{...buttonStateProps}
		>
			<FadeOverflowTextChildren>{children}</FadeOverflowTextChildren>
			{loadingIndicator}
		</ButtonPrimitive>
	);
}

export type { ButtonProps };
export { Button, ButtonLabel, buttonVariants };
