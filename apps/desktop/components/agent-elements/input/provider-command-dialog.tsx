"use client";

import {
	Command,
	CommandDialog,
	CommandInput,
	CommandList,
} from "@ryu/ui/components/command";
import {
	cloneElement,
	createContext,
	type ReactElement,
	type ReactNode,
	useContext,
	useState,
} from "react";

export interface ProviderCommandPage {
	body: ReactNode;
	title: string;
}

interface ProviderCommandNavigation {
	page: ProviderCommandPage | null;
	pop: () => void;
	push: (page: ProviderCommandPage) => void;
}

export const ProviderCommandNavigationContext =
	createContext<ProviderCommandNavigation | null>(null);

export function useProviderCommandNavigation() {
	return useContext(ProviderCommandNavigationContext);
}

interface ProviderCommandDialogProps {
	renderBody: (close: () => void) => ReactNode;
	title?: string;
	trigger: ReactElement<{ onClick?: () => void }>;
}

/** Shared command-dialog shell for provider/model-capable settings fields. */
export function ProviderCommandDialog({
	renderBody,
	title = "Choose provider and model",
	trigger: children,
}: ProviderCommandDialogProps) {
	const [open, setOpen] = useState(false);
	const [pages, setPages] = useState<ProviderCommandPage[]>([]);
	const page = pages.at(-1) ?? null;
	const close = () => {
		setPages([]);
		setOpen(false);
	};
	const navigation: ProviderCommandNavigation = {
		page,
		pop: () => setPages((current) => current.slice(0, -1)),
		push: (next) => setPages((current) => [...current, next]),
	};
	const trigger = cloneElement(children, {
		onClick: () => {
			setPages([]);
			setOpen(true);
		},
	});

	return (
		<>
			{trigger}
			<CommandDialog
				onOpenChange={(next) => (next ? setOpen(true) : close())}
				open={open}
				title={page?.title ?? title}
			>
				<Command>
					{page && (
						<button
							className="sticky top-0 z-20 border-b px-3 py-2 text-left text-muted-foreground text-xs"
							onClick={navigation.pop}
							type="button"
						>
							← Back to {pages.at(-2)?.title ?? title}
						</button>
					)}
					<CommandInput placeholder="Search providers and models…" />
					<CommandList className="max-h-[min(60vh,520px)]">
						<ProviderCommandNavigationContext.Provider value={navigation}>
							{page?.body ?? renderBody(close)}
						</ProviderCommandNavigationContext.Provider>
					</CommandList>
				</Command>
			</CommandDialog>
		</>
	);
}
