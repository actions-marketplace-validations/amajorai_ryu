/** Browser-owned data. Origin isolation is supplied by the browser, not a site ID. */
export function createBrowserStore(namespace: string) {
	if (!/^[a-zA-Z0-9_-]{1,64}$/.test(namespace)) {
		throw new Error("Invalid storage namespace");
	}
	const open = (): Promise<IDBDatabase> =>
		new Promise((resolve, reject) => {
			const request = indexedDB.open(`ryu-local-${namespace}`, 1);
			request.onupgradeneeded = () =>
				request.result.createObjectStore("records");
			request.onsuccess = () => resolve(request.result);
			request.onerror = () =>
				reject(request.error ?? new Error("Local storage unavailable"));
			request.onblocked = () =>
				reject(new Error("Close another tab to upgrade local storage"));
		});
	const transact = async <T>(
		mode: IDBTransactionMode,
		run: (store: IDBObjectStore) => IDBRequest<T>
	): Promise<T> => {
		const db = await open();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction("records", mode);
			const request = run(transaction.objectStore("records"));
			transaction.oncomplete = () => {
				db.close();
				resolve(request.result);
			};
			transaction.onabort = () => {
				db.close();
				reject(transaction.error ?? new Error("Local storage write failed"));
			};
			transaction.onerror = () => {
				db.close();
				reject(transaction.error ?? new Error("Local storage unavailable"));
			};
		});
	};
	return {
		get: (key: string): Promise<unknown> =>
			transact("readonly", (store) => store.get(key)),
		set: async (key: string, value: unknown) => {
			if (key.length > 200 || JSON.stringify(value).length > 2_000_000) {
				throw new Error("Local record exceeds limit");
			}
			await transact("readwrite", (store) => store.put(value, key));
		},
		delete: async (key: string) => {
			await transact("readwrite", (store) => store.delete(key));
		},
		keys: (): Promise<IDBValidKey[]> =>
			transact("readonly", (store) => store.getAllKeys()),
	};
}

export interface BrowserSearchDocument {
	id: string;
	text: string;
	title: string;
}
export interface BrowserSearchHit {
	excerpt: string;
	id: string;
	score: number;
	title: string;
}
/** Bounded lexical retrieval; rebuild from canonical documents. No model is implied. */
export function searchBrowserDocuments(
	documents: readonly BrowserSearchDocument[],
	query: string,
	limit = 8
): BrowserSearchHit[] {
	const terms = [
		...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []),
	].slice(0, 32);
	if (!terms.length) {
		return [];
	}
	if (documents.length > 1000) {
		throw new Error("Local search supports up to 1000 documents");
	}
	const hits: BrowserSearchHit[] = [];
	for (const document of documents) {
		const text = document.text.slice(0, 100_000);
		const lower = text.toLocaleLowerCase();
		const title = document.title.toLocaleLowerCase();
		const score = terms.reduce(
			(sum, term) =>
				sum + (lower.includes(term) ? 1 : 0) + (title.includes(term) ? 2 : 0),
			0
		);
		if (!score) {
			continue;
		}
		const first = Math.max(
			0,
			lower.indexOf(terms.find((term) => lower.includes(term)) ?? "") - 80
		);
		hits.push({
			id: document.id,
			title: document.title,
			excerpt: text.slice(first, first + 500),
			score,
		});
	}
	return hits
		.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
		.slice(0, Math.max(1, Math.min(20, limit)));
}
