import {
	EditorKit,
	type MyEditor,
} from "@ryu/ui/components/editor/editor-kit.tsx";
import { EditorStatic } from "@ryu/ui/components/editor/ui/editor-static.tsx";
import { Plate, usePlateEditor } from "platejs/react";

type EditorKitPlugin = (typeof EditorKit)[number];
type MarkdownEditorPlugin = EditorKitPlugin & {
	api: { markdown: MyEditor["api"]["markdown"] };
	key: "markdown";
};

const markdownPlugin = EditorKit.find(
	(plugin): plugin is MarkdownEditorPlugin => plugin.key === "markdown"
);
export function PagePreview({ source }: { source: string }) {
	const editor = usePlateEditor({
		plugins: EditorKit,
		value: (currentEditor) =>
			currentEditor.getApi(markdownPlugin).markdown.deserialize(source || ""),
	});

	return (
		<Plate editor={editor}>
			<EditorStatic
				className="pointer-events-none max-h-44 overflow-hidden px-4 py-3 text-sm [&_.slate-p]:my-0 [&_.slate-p]:leading-5"
				editor={editor}
				variant="none"
			/>
		</Plate>
	);
}
