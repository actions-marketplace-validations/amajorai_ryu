export const FRONTEND_URL = "http://127.0.0.1:5222";
export async function addAccount() {
	localStorage.setItem(
		"fixture-account-writes",
		String(Number(localStorage.getItem("fixture-account-writes") ?? 0) + 1)
	);
	throw new Error("Unexpected account write in cancellation proof");
}
