import { useSyncExternalStore } from "react";
export const BACKEND_URL = location.origin;
export const TOKEN_KEY = "approval-proof-token";
let session = { user: { id: "first-fixture" } };
const listeners = new Set<() => void>();
export const getActiveUserId = () => session.user.id;
export function setFixtureUser(id: string) {
	session = { user: { id } };
	for (const listener of listeners) {
		listener();
	}
}
export function useSession() {
	return {
		data: useSyncExternalStore(
			(listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			() => session
		),
	};
}
