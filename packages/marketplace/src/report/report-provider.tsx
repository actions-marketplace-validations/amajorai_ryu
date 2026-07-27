// packages/marketplace/src/report/report-provider.tsx
//
// App-wide (or store-wide) report dialog host. Call `useReport().open(target)`
// from any catalog card / sidebar row; the dialog + submit live once here.

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { ReportDialog } from "./report-dialog.tsx";
import type {
	ReportTarget,
	SubmitReportInput,
	SubmitReportResult,
} from "./types.ts";

interface ReportContextValue {
	open: (target: ReportTarget) => void;
}

const ReportContext = createContext<ReportContextValue | null>(null);

export function ReportProvider({
	children,
	onSubmit,
}: {
	children: ReactNode;
	onSubmit: (
		input: SubmitReportInput
	) => Promise<SubmitReportResult | undefined>;
}) {
	const [target, setTarget] = useState<ReportTarget | null>(null);
	const [open, setOpen] = useState(false);

	const openReport = useCallback((next: ReportTarget) => {
		setTarget(next);
		setOpen(true);
	}, []);

	const value = useMemo(() => ({ open: openReport }), [openReport]);

	return (
		<ReportContext.Provider value={value}>
			{children}
			<ReportDialog
				onOpenChange={setOpen}
				onSubmit={onSubmit}
				open={open}
				target={target}
			/>
		</ReportContext.Provider>
	);
}

/** Open the shared report dialog. Throws if no ReportProvider is mounted. */
export function useReport(): ReportContextValue {
	const ctx = useContext(ReportContext);
	if (!ctx) {
		throw new Error("useReport must be used within a <ReportProvider>.");
	}
	return ctx;
}

/** Soft read — returns null when no provider (e.g. a surface without reporting). */
export function useOptionalReport(): ReportContextValue | null {
	return useContext(ReportContext);
}
