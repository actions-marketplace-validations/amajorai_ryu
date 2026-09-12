const organizations: { id: string }[] = [];
export function useMarketplaceFollowing() {
	return {
		followingOnly: new URLSearchParams(location.search).has("following"),
		organizations,
	};
}
