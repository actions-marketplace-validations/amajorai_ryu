import { useCallback, useEffect, useState } from "react";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	addTeamMember as apiAddMember,
	createTeam as apiCreateTeam,
	deleteTeam as apiDeleteTeam,
	removeTeamMember as apiRemoveMember,
	updateTeam as apiUpdateTeam,
	type CreateTeamInput,
	fetchTeams,
	type Team,
	type UpdateTeamInput,
} from "@/src/lib/api/teams.ts";
import { useActiveNode } from "./useActiveNode.ts";

export interface UseTeamsResult {
	addMember: (teamId: string, agentId: string) => Promise<Team>;
	create: (input: CreateTeamInput) => Promise<Team>;
	error: string | null;
	loading: boolean;
	reload: () => Promise<void>;
	remove: (id: string) => Promise<void>;
	removeMember: (teamId: string, agentId: string) => Promise<Team>;
	teams: Team[];
	update: (id: string, input: UpdateTeamInput) => Promise<Team>;
}

/// Loads agent groups from the active Core node and exposes CRUD + member
/// management that keep the in-memory list in sync after each mutation, so the
/// sidebar (and the chat @mention list) reflect edits immediately.
export function useTeams(): UseTeamsResult {
	const activeNode = useActiveNode();
	const { url } = activeNode;
	const token = activeNode.token ?? null;
	const userJwt = activeNode.userJwt ?? null;

	const [teams, setTeams] = useState<Team[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		setLoading(true);
		setError(null);
		const node: ApiTarget = { url, token, userJwt };
		try {
			setTeams(await fetchTeams(node));
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load teams");
		} finally {
			setLoading(false);
		}
	}, [url, token, userJwt]);

	useEffect(() => {
		reload().catch(() => undefined);
	}, [reload]);

	const upsert = useCallback((team: Team) => {
		setTeams((prev) => {
			const exists = prev.some((t) => t.id === team.id);
			return exists
				? prev.map((t) => (t.id === team.id ? team : t))
				: [...prev, team];
		});
	}, []);

	const create = useCallback(
		async (input: CreateTeamInput) => {
			const team = await apiCreateTeam({ url, token, userJwt }, input);
			upsert(team);
			return team;
		},
		[url, token, userJwt, upsert]
	);

	const update = useCallback(
		async (id: string, input: UpdateTeamInput) => {
			const team = await apiUpdateTeam({ url, token, userJwt }, id, input);
			upsert(team);
			return team;
		},
		[url, token, userJwt, upsert]
	);

	const remove = useCallback(
		async (id: string) => {
			await apiDeleteTeam({ url, token, userJwt }, id);
			setTeams((prev) => prev.filter((t) => t.id !== id));
		},
		[url, token, userJwt]
	);

	const addMember = useCallback(
		async (teamId: string, agentId: string) => {
			const team = await apiAddMember({ url, token, userJwt }, teamId, agentId);
			upsert(team);
			return team;
		},
		[url, token, userJwt, upsert]
	);

	const removeMember = useCallback(
		async (teamId: string, agentId: string) => {
			const team = await apiRemoveMember(
				{ url, token, userJwt },
				teamId,
				agentId
			);
			upsert(team);
			return team;
		},
		[url, token, userJwt, upsert]
	);

	return {
		teams,
		loading,
		error,
		reload,
		create,
		update,
		remove,
		addMember,
		removeMember,
	};
}
