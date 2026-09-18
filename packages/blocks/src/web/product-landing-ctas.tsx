import { buttonVariants } from "@ryu/ui/components/button";
import { cn } from "@ryu/ui/lib/utils";
import { SETUP_RYU_HREF, SETUP_RYU_LABEL } from "./data/resources.tsx";
import { DownloadMenu } from "./download-menu.tsx";

/** The shared conversion pair used by every focused product landing page. */
export default function ProductLandingCtas({
	className,
}: {
	className?: string;
}) {
	return (
		<div
			className={cn("flex flex-col items-center gap-3 sm:flex-row", className)}
		>
			<DownloadMenu label="Download" showSeparator={false} size="default" />
			<a
				className={cn(buttonVariants({ variant: "secondary" }), "rounded-full")}
				href={SETUP_RYU_HREF}
			>
				{SETUP_RYU_LABEL}
			</a>
		</div>
	);
}
