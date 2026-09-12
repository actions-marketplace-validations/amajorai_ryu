export const browser = {
	tabs: {
		create: async () => {
			document.documentElement.dataset.opened = String(
				Number(document.documentElement.dataset.opened ?? 0) + 1
			);
			return { id: 1 };
		},
	},
};
