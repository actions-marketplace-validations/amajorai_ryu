"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { useLocalizedText } from "@ryu/i18n/react";

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
	return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({
	children,
	...props
}: CollapsiblePrimitive.Trigger.Props) {
	const localizedChildren = useLocalizedText(children, { literal: true });
	return (
		<CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props}>
			{localizedChildren}
		</CollapsiblePrimitive.Trigger>
	);
}

function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props) {
	return (
		<CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />
	);
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
