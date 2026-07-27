// apps/desktop/src/components/marketplace/report-host.tsx
//
// App-shell report dialog so sidebar rows (outside the Store host) can report.

import { ReportProvider } from "@ryu/marketplace/report";
import type { ReactNode } from "react";
import { submitReport } from "@/src/lib/api/marketplace.ts";

export function DesktopReportHost({ children }: { children: ReactNode }) {
	return <ReportProvider onSubmit={submitReport}>{children}</ReportProvider>;
}
