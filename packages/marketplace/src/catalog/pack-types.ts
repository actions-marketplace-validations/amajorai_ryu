// packages/marketplace/src/catalog/pack-types.ts
//
// Structural types for the Skills catalog's **packs** surface. A pack is a named
// collection of skills — a repo whose `SKILL.md` dirs are the members (the
// "repo is a pack" model skills.sh uses), or a custom user-defined pack (a
// manifest of skills.sh ids + repo URLs). These declare ONLY the fields the
// shared section renders, mirroring `types.ts`: desktop passes its concrete
// Core-backed hook result (a superset), web fabricates exactly these from its
// federated feed, and a host with no pack seam omits the hook so the shelf
// never renders.

/** One pack row in the Packs shelf. */
export interface SkillPackCard {
	/** Stable id. For a repo pack it is `owner/repo`; custom packs use a slug. */
	id: string;
	/** Display name. */
	name: string;
	/** One-line "what this pack contains". */
	description: string;
	/** True for the catalog Ryu ships (non-removable, system-managed). */
	builtin: boolean;
	/** How many skills resolve into this pack (0 while resolving/failed). */
	memberCount: number;
}

/** One resolved member skill of a pack. */
export interface SkillPackMember {
	/** Full skill id (`owner/repo/slug`, or the repo+leaf for a repo pack). */
	id: string;
	name: string;
	description?: string | null;
	installed: boolean;
}

/** A pack with its resolved members (the "open the pack" detail view). */
export interface SkillPackDetail extends SkillPackCard {
	members: SkillPackMember[];
}

/** What the Packs shelf consumes from its injected data hook. */
export interface SkillPacksState {
	error: string | null;
	/** The pack whose install is in flight, or null. */
	installing: string | null;
	/** Install every member of a pack; resolves to the slugs that landed. */
	install: (id: string) => Promise<string[]>;
	loading: boolean;
	/** Open a pack to reveal its member skills; `null`/"" closes it. */
	open: (id: string) => void;
	opened: SkillPackDetail | null;
	opening: string | null;
	packs: SkillPackCard[];
	refresh: () => void;
}
