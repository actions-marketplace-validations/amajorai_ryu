import { CHAT_REFERENCE_DRAG_MIME } from "../components/layout/tabDnd.tsx";

export interface DraggedChatReference {
	id: string;
	label: string;
}

export function readDraggedChatReference(
	dataTransfer: DataTransfer
): DraggedChatReference | null {
	try {
		const value = JSON.parse(
			dataTransfer.getData(CHAT_REFERENCE_DRAG_MIME)
		) as Partial<DraggedChatReference>;
		return typeof value.id === "string" && typeof value.label === "string"
			? { id: value.id, label: value.label }
			: null;
	} catch {
		return null;
	}
}
