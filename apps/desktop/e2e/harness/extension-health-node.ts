import { create } from "zustand";

interface Node {
	name: string;
	token: string | null;
	url: string;
}
export const useNodeStore = create<{ node: Node; getActiveNode: () => Node }>(
	(_set, get) => ({
		node: { name: "Alpha", url: "http://127.0.0.1:5215/alpha", token: null },
		getActiveNode: () => get().node,
	})
);
