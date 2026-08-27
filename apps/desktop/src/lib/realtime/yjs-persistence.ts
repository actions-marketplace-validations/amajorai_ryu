const DATABASE_NAME = "ryu-collaboration";
const DATABASE_VERSION = 1;
const STORE_NAME = "yjs-snapshots";

function openDatabase(): Promise<IDBDatabase | null> {
	if (typeof indexedDB === "undefined") {
		return Promise.resolve(null);
	}
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains(STORE_NAME)) {
				database.createObjectStore(STORE_NAME);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(request.error ?? new Error("IndexedDB open failed"));
	});
}

export async function loadYjsSnapshot(
	roomId: string
): Promise<Uint8Array | null> {
	const database = await openDatabase();
	if (!database) {
		return null;
	}
	try {
		return await new Promise((resolve, reject) => {
			const request = database
				.transaction(STORE_NAME, "readonly")
				.objectStore(STORE_NAME)
				.get(roomId);
			request.onsuccess = () => {
				const value = request.result;
				resolve(value instanceof ArrayBuffer ? new Uint8Array(value) : null);
			};
			request.onerror = () =>
				reject(request.error ?? new Error("Yjs snapshot read failed"));
		});
	} finally {
		database.close();
	}
}

export async function storeYjsSnapshot(
	roomId: string,
	update: Uint8Array
): Promise<void> {
	const database = await openDatabase();
	if (!database) {
		return;
	}
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(STORE_NAME, "readwrite");
			transaction.objectStore(STORE_NAME).put(update.slice().buffer, roomId);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () =>
				reject(transaction.error ?? new Error("Yjs snapshot write failed"));
		});
	} finally {
		database.close();
	}
}

export async function clearYjsSnapshot(roomId: string): Promise<void> {
	const database = await openDatabase();
	if (!database) {
		return;
	}
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(STORE_NAME, "readwrite");
			transaction.objectStore(STORE_NAME).delete(roomId);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () =>
				reject(transaction.error ?? new Error("Yjs snapshot delete failed"));
		});
	} finally {
		database.close();
	}
}
