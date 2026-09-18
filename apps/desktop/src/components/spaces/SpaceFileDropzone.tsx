import { FileUpload } from "@ryu/ui/components/file-upload.tsx";
import { useSpaceFileUpload } from "@/src/hooks/useSpaceFileUpload.ts";

export function SpaceFileDropzone({
	description = "Files are read and indexed by this node",
	onUploadComplete,
	spaceId,
	title = "Drop files here",
}: {
	description?: string;
	onUploadComplete?: () => void;
	spaceId: string | null;
	title?: string;
}) {
	const { onFilesAdded, onRemove, onRetry, queue } = useSpaceFileUpload(
		spaceId,
		onUploadComplete
	);

	return (
		<FileUpload
			description={description}
			disabled={!spaceId}
			items={queue}
			onFilesAdded={onFilesAdded}
			onRemove={onRemove}
			onRetry={onRetry}
			title={title}
		/>
	);
}
