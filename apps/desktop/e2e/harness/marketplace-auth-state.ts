import { create } from "zustand";
export const useAuthState = create(() => ({
	user: "alpha" as string | null,
	organization: "org",
}));
export const authClient = {
	useSession: () => {
		const { user } = useAuthState();
		return {
			data: user
				? { user: { id: user }, session: { id: `session-${user}` } }
				: null,
			isPending: false,
		};
	},
	useActiveOrganization: () => {
		const { organization } = useAuthState();
		return { data: { id: organization }, isPending: false };
	},
};
