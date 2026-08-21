import { useEffect, useState } from "react";
import {
	readStartupSelectionPreferences,
	type StartupSelectionMode,
	setStartupDefaultAccountId,
	setStartupDefaultNodeName,
	setStartupSelectionMode,
} from "@/src/lib/startup-selection.ts";

export function useStartupSelection() {
	const [preferences, setPreferences] = useState(
		readStartupSelectionPreferences
	);

	useEffect(() => {
		const handleChange = () =>
			setPreferences(readStartupSelectionPreferences());
		window.addEventListener("storage", handleChange);
		return () => window.removeEventListener("storage", handleChange);
	}, []);

	return {
		preferences,
		setDefaultAccountId: (userId: string | null) => {
			setStartupDefaultAccountId(userId);
			setPreferences(readStartupSelectionPreferences());
		},
		setDefaultNodeName: (name: string | null) => {
			setStartupDefaultNodeName(name);
			setPreferences(readStartupSelectionPreferences());
		},
		setMode: (mode: StartupSelectionMode) => {
			setStartupSelectionMode(mode);
			setPreferences(readStartupSelectionPreferences());
		},
	};
}
