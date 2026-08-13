"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@ryu/ui/lib/utils.ts";
import { cva, type VariantProps } from "class-variance-authority";

function Tabs({
	className,
	orientation = "horizontal",
	...props
}: TabsPrimitive.Root.Props) {
	return (
		<TabsPrimitive.Root
			className={cn(
				"group/tabs flex gap-2 data-horizontal:flex-col",
				className
			)}
			data-orientation={orientation}
			data-slot="tabs"
			{...props}
		/>
	);
}

const tabsListVariants = cva(
	// `relative` on every variant (not just segmented) so an optional sliding
	// TabsIndicator can anchor its absolute box against any list.
	"group/tabs-list relative inline-flex w-fit items-center justify-center rounded-full p-1 text-muted-foreground data-[variant=line]:rounded-none group-data-horizontal/tabs:h-9 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:rounded-2xl",
	{
		variants: {
			variant: {
				default: "bg-muted",
				line: "gap-1 bg-transparent",
				// Stepper: a rule ABOVE each label rather than an underline below the
				// active one, so the strip reads as a sequence of steps you can see the
				// whole of at once. Every step stays selectable — it suggests an order
				// without enforcing one, which is what separates it from `stepper.tsx`
				// (that primitive has a notion of "reached" and gates on it).
				stepper:
					"w-full items-start gap-4 rounded-none bg-transparent p-0 group-data-horizontal/tabs:h-fit",
				pills:
					"flex-wrap gap-2 rounded-none bg-transparent p-0 group-data-horizontal/tabs:h-fit",
				// Same pill, more room. For surfaces where the tab strip IS the
				// primary control rather than a filter above a table — a share
				// dialog's Image/Video switch, say — and a 28px-tall pill reads as
				// incidental. Every `pills` rule below is written with a `^=pills`
				// prefix match so this variant inherits them and only overrides the
				// padding; duplicating a dozen classes per variant is how the two
				// would drift.
				"pills-lg":
					"flex-wrap gap-2 rounded-none bg-transparent p-0 group-data-horizontal/tabs:h-fit",
				segmented: "relative gap-1 bg-muted",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	}
);

function TabsList({
	className,
	variant = "default",
	...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
	return (
		<TabsPrimitive.List
			className={cn(tabsListVariants({ variant }), className)}
			data-slot="tabs-list"
			data-variant={variant}
			{...props}
		/>
	);
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
	return (
		<TabsPrimitive.Tab
			className={cn(
				"relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-transparent! px-3 py-1 font-medium text-foreground/60 text-sm transition-all hover:text-foreground focus-visible:border-ring focus-visible:outline-1 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-disabled:pointer-events-none aria-disabled:opacity-50 group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:rounded-2xl group-data-vertical/tabs:px-3 group-data-vertical/tabs:py-1.5 dark:text-muted-foreground dark:hover:text-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
				"group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
				// The rule is the trigger's own `::before`, so the label sits under it
				// with no extra element. `whitespace-normal` because a three-word step
				// clipped to "Reserve your han…" in a narrow column loses the one
				// instruction it exists to give — the rules are what align the strip,
				// so a second line only makes it taller.
				"group-data-[variant=stepper]/tabs-list:h-auto group-data-[variant=stepper]/tabs-list:flex-col group-data-[variant=stepper]/tabs-list:items-start group-data-[variant=stepper]/tabs-list:gap-2 group-data-[variant=stepper]/tabs-list:whitespace-normal group-data-[variant=stepper]/tabs-list:rounded-sm group-data-[variant=stepper]/tabs-list:px-0 group-data-[variant=stepper]/tabs-list:py-0 group-data-[variant=stepper]/tabs-list:text-left group-data-[variant=stepper]/tabs-list:text-muted-foreground/60 group-data-[variant=stepper]/tabs-list:text-xs",
				"group-data-[variant=stepper]/tabs-list:before:h-1 group-data-[variant=stepper]/tabs-list:before:w-full group-data-[variant=stepper]/tabs-list:before:rounded-full group-data-[variant=stepper]/tabs-list:before:bg-border group-data-[variant=stepper]/tabs-list:before:transition-colors group-data-[variant=stepper]/tabs-list:before:content-['']",
				"group-data-[variant=stepper]/tabs-list:data-active:bg-transparent! group-data-[variant=stepper]/tabs-list:data-active:text-foreground group-data-[variant=stepper]/tabs-list:data-active:after:opacity-0 group-data-[variant=stepper]/tabs-list:data-active:before:bg-foreground",
				// Copied from the original repo's `pills` trigger, minus the outline:
				// `rounded-full px-4 py-2 text-sm`, a hover wash, and a filled black
				// pill for the active tab. An inactive pill is a label and its padding,
				// nothing else — the base trigger above pins `border-transparent!`, so
				// leaving the border undeclared here is what keeps it invisible.
				//
				// `pills-lg` deliberately resolves to the SAME box. It used to fork the
				// size (`h-14!`, then wider sides), and every attempt to make the large
				// one look right made it look like a blob instead. The prefix match
				// covers both names so the two cannot drift again.
				"group-data-[variant^=pills]/tabs-list:h-auto group-data-[variant^=pills]/tabs-list:flex-initial group-data-[variant^=pills]/tabs-list:gap-2 group-data-[variant^=pills]/tabs-list:rounded-full group-data-[variant^=pills]/tabs-list:px-4 group-data-[variant^=pills]/tabs-list:py-2 group-data-[variant^=pills]/tabs-list:text-foreground group-data-[variant^=pills]/tabs-list:text-sm group-data-[variant^=pills]/tabs-list:hover:bg-black/5 group-data-[variant^=pills]/tabs-list:hover:text-foreground dark:group-data-[variant^=pills]/tabs-list:text-foreground dark:group-data-[variant^=pills]/tabs-list:hover:bg-white/10",
				// `text-white!` / `text-black!` rather than plain: the unguarded
				// `data-active:text-foreground` on the line below outranks them in
				// Tailwind's output order, which painted a pills list's active label
				// near-black on its own black pill — unreadable. The neighbouring
				// background rules already carry `!` for the same reason.
				"group-data-[variant^=pills]/tabs-list:data-active:border-transparent! group-data-[variant^=pills]/tabs-list:data-active:bg-black! group-data-[variant^=pills]/tabs-list:data-active:text-white! dark:group-data-[variant^=pills]/tabs-list:data-active:bg-white! dark:group-data-[variant^=pills]/tabs-list:data-active:text-black!",
				"data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
				// Segmented: the sliding TabsIndicator owns the active background, so the
				// trigger itself stays transparent and only animates its text colour. It
				// sits above the indicator (z-10) so the label reads on top of the pill.
				"group-data-[variant=segmented]/tabs-list:z-10 group-data-[variant=segmented]/tabs-list:bg-transparent! group-data-[variant=segmented]/tabs-list:text-foreground/60 group-data-[variant=segmented]/tabs-list:data-active:border-transparent! group-data-[variant=segmented]/tabs-list:data-active:bg-transparent! group-data-[variant=segmented]/tabs-list:data-active:text-foreground group-data-[variant=segmented]/tabs-list:hover:text-foreground dark:group-data-[variant=segmented]/tabs-list:data-active:bg-transparent!",
				"after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
				// When a sliding TabsIndicator is present in the list, hand the active
				// visual (background / border / underline) over to it and keep the
				// trigger's own only its text colour. The `:has()` here outranks the
				// per-variant active-bg rules above, so it wins even against their `!`.
				//
				// `z-10` for the same reason `segmented` carries it, and it belongs
				// here rather than on that one variant: the indicator is absolutely
				// positioned and the trigger is not, so the indicator paints OVER the
				// label whatever the DOM order — a `pills` list with an indicator drew
				// its active tab as unreadable dark-on-black.
				"group-has-[[data-slot=tabs-indicator]]/tabs-list:z-10 group-has-[[data-slot=tabs-indicator]]/tabs-list:data-active:border-transparent! group-has-[[data-slot=tabs-indicator]]/tabs-list:data-active:bg-transparent! group-has-[[data-slot=tabs-indicator]]/tabs-list:data-active:hover:bg-transparent! group-has-[[data-slot=tabs-indicator]]/tabs-list:data-active:after:opacity-0",
				className
			)}
			data-slot="tabs-trigger"
			{...props}
		/>
	);
}

/**
 * Sliding active-tab indicator (transitions.dev "tabs sliding", 16). Base UI
 * positions it over the active tab via the --active-tab-* CSS vars; the
 * `t-tabs-indicator` class (globals.css) tweens left/top/width/height. Render
 * it as a child of ANY TabsList (`default` · `line` · `pills` · `segmented`) to
 * animate that variant's active marker; the trigger cedes its own active
 * background/underline to this element (see TabsTrigger). Its look adapts per
 * variant: a raised pill for default/segmented, a solid pill for pills, and a
 * bottom bar for line.
 */
function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
	return (
		<TabsPrimitive.Indicator
			className={cn(
				// default + segmented: the raised pill.
				"t-tabs-indicator z-0 rounded-full bg-background shadow-sm dark:bg-input/30",
				// pills: a solid black (light) / white (dark) pill, no shadow.
				"group-data-[variant^=pills]/tabs-list:bg-black group-data-[variant^=pills]/tabs-list:shadow-none dark:group-data-[variant^=pills]/tabs-list:bg-white",
				// line: a bottom bar instead of a filled pill.
				"group-data-vertical/tabs:group-data-[variant=line]/tabs-list:border-r-2 group-data-horizontal/tabs:group-data-[variant=line]/tabs-list:border-b-2 group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:border-foreground group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:shadow-none",
				className
			)}
			data-slot="tabs-indicator"
			{...props}
		/>
	);
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
	return (
		<TabsPrimitive.Panel
			className={cn("flex-1 text-sm outline-none", className)}
			data-slot="tabs-content"
			{...props}
		/>
	);
}

export {
	Tabs,
	TabsContent,
	TabsIndicator,
	TabsList,
	TabsTrigger,
	tabsListVariants,
};
