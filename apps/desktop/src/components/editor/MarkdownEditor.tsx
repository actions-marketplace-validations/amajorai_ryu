import { Spinner } from "@ryu/ui/components/spinner";
import { type ComponentProps, lazy, Suspense } from "react";

export type { MarkdownCollab } from "./MarkdownEditorContent.tsx";

type MarkdownEditorProps = ComponentProps<
	typeof import("./MarkdownEditorContent.tsx").MarkdownEditor
>;
const EditorContent = lazy(() =>
	import("./MarkdownEditorContent.tsx").then((module) => ({
		default: module.MarkdownEditor,
	}))
);

/** Load the editor toolkit only when a real editor is mounted. */
export function MarkdownEditor(props: MarkdownEditorProps) {
	return (
		<Suspense
			fallback={
				<div className="grid min-h-32 w-full flex-1 place-items-center">
					<Spinner />
				</div>
			}
		>
			<EditorContent {...props} />
		</Suspense>
	);
}
