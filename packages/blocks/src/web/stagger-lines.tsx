import type { ReactNode } from "react";

export function StaggerLines({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <div className={className}>{children}</div>;
}
