import { OpenInNewWindowContextMenuItem } from "./OpenInNewWindowMenuItem.tsx";
import { useTabDnd } from "./tabDnd.tsx";

export function MoveTabToWindowMenuItem({ tabId }: { tabId: string }) {
	const { moveToWindow } = useTabDnd();
	return (
		<OpenInNewWindowContextMenuItem
			iconClassName="size-4"
			label="Move tab to new window"
			onClick={() => void moveToWindow(tabId)}
		/>
	);
}
