// apps/desktop/src/lib/api/uploads.ts
//
// User file uploads → Core's Uploads system space (`POST /api/uploads`). Chat
// attachments, page/editor media, and `ui.uploadFile` all share this path so
// bytes land as first-class Space file documents (not `~/.ryu/media/`).

import { type ApiTarget, apiUrl, identityHeaders } from "./client.ts";

/** A stored upload. `url` is relative (`/api/uploads/<id>`); callers prepend the
 *  node base when rendering. */
export interface UploadObject {
	contentType: string;
	fileName: string;
	id: string;
	size: number;
	spaceId: string;
	/** Relative serve path (`/api/uploads/<id>`). */
	url: string;
}

interface UploadWire {
	content_type?: string;
	file_name?: string;
	id: string;
	size?: number;
	space_id?: string;
	url: string;
}

/** Read a File into a `data:` URL (for AI-SDK multimodal file parts). */
export function fileToDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			resolve(reader.result as string);
		};
		reader.onerror = () => {
			reject(reader.error ?? new Error(`failed to read ${file.name}`));
		};
		reader.readAsDataURL(file);
	});
}

/**
 * Persist `file` into the Uploads system space. Returns the stored object; the
 * absolute URL for rendering is `target.url + result.url`.
 */
export async function uploadUserFile(
	target: ApiTarget,
	file: File | Blob,
	opts?: { fileName?: string; signal?: AbortSignal }
): Promise<UploadObject> {
	const fileName =
		opts?.fileName ??
		(file instanceof File && file.name ? file.name : "upload");
	const headers: Record<string, string> = {
		...identityHeaders(),
		"x-filename": fileName,
		"content-type": file.type || "application/octet-stream",
	};
	if (target.token) {
		headers.authorization = `Bearer ${target.token}`;
	}
	const res = await fetch(apiUrl(target, "/api/uploads"), {
		method: "POST",
		headers,
		body: file,
		signal: opts?.signal,
	});
	if (!res.ok) {
		let detail = "";
		try {
			const err = (await res.json()) as { error?: string };
			detail = err.error ? `: ${err.error}` : "";
		} catch {
			// ignore
		}
		throw new Error(`Upload failed (${res.status})${detail}`);
	}
	const data = (await res.json()) as UploadWire;
	return {
		id: data.id,
		spaceId: data.space_id ?? "",
		fileName: data.file_name ?? fileName,
		url: data.url,
		size: data.size ?? (file instanceof Blob ? file.size : 0),
		contentType: data.content_type || file.type || "application/octet-stream",
	};
}

/**
 * Stage a chat/composer image: keep a `data:` URL for the model turn, and
 * persist into Uploads in parallel (best-effort — model send must not fail if
 * the Spaces write hiccups).
 */
export async function stageImageUpload(
	target: ApiTarget,
	file: File
): Promise<{ dataUrl: string; upload: UploadObject | null }> {
	const dataUrlPromise = fileToDataUrl(file);
	const uploadPromise = uploadUserFile(target, file).catch((err: unknown) => {
		console.warn("[uploads] failed to persist chat attachment:", err);
		return null;
	});
	const [dataUrl, upload] = await Promise.all([dataUrlPromise, uploadPromise]);
	return { dataUrl, upload };
}
