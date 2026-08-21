import { Button } from "@ryu/ui/components/button";
import type { AnswerNowControl } from "./answer-now.ts";

export function AnswerNowButton({ control }: { control: AnswerNowControl }) {
	const label = control.pending ? "Finishing answer" : "Answer now";
	return (
		<Button
			aria-label={label}
			className="h-auto px-0 text-muted-foreground text-xs underline underline-offset-4 hover:text-foreground"
			disabled={control.pending}
			onClick={control.onClick}
			title={label}
			type="button"
			variant="link"
		>
			{control.pending ? "Finishing…" : "Answer now"}
		</Button>
	);
}
