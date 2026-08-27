import { exportToDocx, importDocx } from "@platejs/docx-io";
import { BaseEditorKit } from "@ryu/ui/components/editor/editor-base-kit.tsx";
import { EditorKit } from "@ryu/ui/components/editor/editor-kit.tsx";
import { DocxExportKit } from "@ryu/ui/components/editor/plugins/docx-export-kit.tsx";
import {
	Editor,
	EditorContainer,
} from "@ryu/ui/components/editor/ui/editor.tsx";
import { FixedToolbar } from "@ryu/ui/components/editor/ui/fixed-toolbar.tsx";
import { FixedToolbarButtons } from "@ryu/ui/components/editor/ui/fixed-toolbar-buttons.tsx";
import { type SlatePlugin, setValue, type Value } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";
import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";

export interface FileEditorHandle {
	exportFile: () => Promise<Blob>;
}

interface DocxEditorProps {
	bytes: ArrayBuffer;
	onDirty: () => void;
	onLoadError: (message: string) => void;
}

export const DocxEditor = forwardRef<FileEditorHandle, DocxEditorProps>(
	function DocxEditor({ bytes, onDirty, onLoadError }, ref) {
		const editor = usePlateEditor({
			plugins: EditorKit,
			value: [{ children: [{ text: "" }], type: "p" }],
		});
		const importing = useRef(true);
		const [ready, setReady] = useState(false);

		useEffect(() => {
			let cancelled = false;
			importing.current = true;
			setReady(false);
			importDocx(editor, bytes)
				.then((result) => {
					if (cancelled) {
						return;
					}
					setValue(editor, result.nodes as Value);
					importing.current = false;
					setReady(true);
				})
				.catch((error: unknown) => {
					if (cancelled) {
						return;
					}
					onLoadError(
						error instanceof Error
							? error.message
							: "This Word document could not be opened."
					);
				});
			return () => {
				cancelled = true;
			};
		}, [bytes, editor, onLoadError]);

		useImperativeHandle(
			ref,
			() => ({
				exportFile: () =>
					exportToDocx(editor.children, {
						editorPlugins: [
							...BaseEditorKit,
							...DocxExportKit,
						] as SlatePlugin[],
					}),
			}),
			[editor]
		);

		return (
			<div className="flex min-h-0 flex-1 flex-col bg-background">
				<div className="border-border/60 border-b px-2 py-1">
					<FixedToolbar>
						<FixedToolbarButtons placement="inline" />
					</FixedToolbar>
				</div>
				<Plate
					editor={editor}
					onChange={() => {
						if (ready && !importing.current) {
							onDirty();
						}
					}}
				>
					<EditorContainer className="min-h-0 flex-1 overflow-y-auto">
						<Editor placeholder="Start writing…" />
					</EditorContainer>
				</Plate>
			</div>
		);
	}
);
