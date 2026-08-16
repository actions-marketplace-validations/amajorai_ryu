// Standalone browser story for the REAL shared `SkillsCatalogSection` — the one
// desktop and web both mount — driven by a fake `CatalogHost` whose `select`
// behaves exactly like a shipping host's: it stores whatever id it is handed.
//
// Why a browser story rather than a unit test: the preview is a PORTALED dialog,
// which `renderToStaticMarkup` never emits (the section's unit tests say so), so
// "the preview closes" is only observable in a real DOM. The regression it pins:
// the layout asked `selectedId != null`, and closing the preview calls
// `select("")` — a value that is not null. The dialog therefore re-opened itself
// on close, with nothing selected to render ("No skill selected") and no click
// able to dismiss it.
//
// The only stub is the host (no Core here). Everything between it and the pixels
// — section, layout, dialog — is the shipping code.

import {
	type CatalogHost,
	CatalogHostProvider,
} from "@ryu/marketplace/catalog/host";
import SkillsCatalogSection from "@ryu/marketplace/catalog/skills";
import {
	ALL_SKILL_SOURCES_ID,
	type SkillCard,
	type SkillDetail,
	type SkillsCatalogState,
} from "@ryu/marketplace/catalog/types";
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

const SKILLS: SkillCard[] = [
	{
		catalogSourceId: "skills-sh",
		catalogSourceName: "skills.sh",
		id: "acme/repo/pdf-filler",
		installed: false,
		installs: 1200,
		name: "PDF Filler",
		slug: "pdf-filler",
		source: "skills.sh",
		trustLevel: "community",
	},
	{
		catalogSourceId: "skills-sh",
		catalogSourceName: "skills.sh",
		id: "acme/repo/csv-tidy",
		installed: false,
		installs: 40,
		name: "CSV Tidy",
		slug: "csv-tidy",
		source: "skills.sh",
		trustLevel: "community",
	},
	{
		catalogSourceId: "browse-sh",
		catalogSourceName: "browse.sh",
		id: "browse.sh/web-search",
		installed: false,
		installs: 980,
		name: "Web Search",
		slug: "web-search",
		source: "browse.sh",
		trustLevel: "trusted",
	},
	{
		catalogSourceId: "clawhub",
		catalogSourceName: "ClawHub",
		id: "clawhub/skill-auditor",
		installed: false,
		installs: 760,
		name: "Skill Auditor",
		slug: "skill-auditor",
		source: "ClawHub",
		trustLevel: "community",
	},
	{
		catalogSourceId: "lobehub",
		catalogSourceName: "LobeHub",
		id: "lobehub/lateral-thinking",
		installed: false,
		installs: 430,
		name: "Lateral Thinking",
		slug: "lateral-thinking",
		source: "LobeHub",
		trustLevel: "community",
	},
	{
		catalogSourceId: "ryu-marketplace",
		catalogSourceName: "Ryu Marketplace",
		id: "ryu/meeting-notes",
		installed: false,
		installs: 210,
		name: "Meeting Notes",
		slug: "meeting-notes",
		source: "Ryu Marketplace",
		trustLevel: "builtin",
	},
];

function detailFor(id: string): SkillDetail | null {
	const card = SKILLS.find((s) => s.id === id);
	if (!card) {
		return null;
	}
	return {
		card,
		description: "A skill.",
		files: [{ path: "SKILL.md" }],
		metadata: {
			firstSeen: null,
			githubCreatedAt: null,
			githubPushedAt: null,
			githubStars: null,
			githubUpdatedAt: null,
			installs: null,
			repositoryUrl: null,
			securityAudits: [],
		},
		readme: `# ${card.name}\n\nA skill.`,
		url: `https://skills.sh/${card.slug}`,
	};
}

const NOOP = () => undefined;
const NOOP_ASYNC = () => Promise.resolve();

/** A host whose `select` stores the raw id — including the empty string the
 *  layout sends on close. Normalising it here would hide the very bug this story
 *  exists to catch. */
function useStorySkillsCatalog(): SkillsCatalogState {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [activeSource, setActiveSource] = useState(ALL_SKILL_SOURCES_ID);
	const select = useCallback((id: string) => setSelectedId(id), []);
	const selectSource = useCallback((id: string) => {
		setActiveSource(id);
		setSelectedId(null);
	}, []);
	const visibleSkills =
		activeSource === ALL_SKILL_SOURCES_ID
			? SKILLS
			: SKILLS.filter((skill) => skill.catalogSourceId === activeSource);
	return {
		activeSource,
		addingMarketplace: false,
		addMarketplace: NOOP_ASYNC,
		detail: selectedId ? detailFor(selectedId) : null,
		detailError: null,
		detailLoading: false,
		enabledByKey: {},
		error: null,
		fetchNextPage: NOOP,
		hasNextPage: false,
		install: NOOP_ASYNC,
		installedOnly: false,
		installing: null,
		loading: false,
		org: "",
		query: "",
		select,
		selectedId,
		selectingSource: false,
		selectSource,
		setInstalledOnly: NOOP,
		setOrg: NOOP,
		setQuery: NOOP,
		setSkillEnabled: NOOP_ASYNC,
		setSort: NOOP,
		skills: visibleSkills,
		sort: "popular",
		sources: [
			{ builtin: true, displayName: "skills.sh", id: "skills-sh" },
			{ builtin: true, displayName: "browse.sh", id: "browse-sh" },
			{ builtin: true, displayName: "ClawHub", id: "clawhub" },
			{ builtin: true, displayName: "LobeHub", id: "lobehub" },
			{
				builtin: true,
				displayName: "Ryu Marketplace",
				id: "ryu-marketplace",
			},
		],
		togglingSkill: null,
	};
}

const host: CatalogHost = {
	install: {
		InstallButton: ({ children }) => <button type="button">{children}</button>,
	},
	Markdown: ({ content }) => <div>{content}</div>,
	openExternal: NOOP,
	renderAffordance: (target) => <span>Open {target.name} in Ryu</span>,
	useAppsCatalog: () => {
		throw new Error("unused");
	},
	useSkillsCatalog: useStorySkillsCatalog,
	useModelCatalog: () => {
		throw new Error("unused");
	},
	useActiveNode: () => ({ url: "", token: null }),
	usePersistedToggle: (_k: string, d: boolean) =>
		[d, NOOP] as [boolean, (v: boolean) => void],
	installSidecar: NOOP_ASYNC,
	estimateLlmfit: () =>
		Promise.resolve({
			fit_level: null,
			installed: false,
			matched: false,
			min_vram_gb: null,
			path: null,
			tps: null,
		}),
	useInstalledModels: () => [],
	ActiveModelControl: () => null,
	fitStyle: () => ({ className: "", dot: "" }),
};

function Story() {
	return (
		<div style={{ height: "100vh" }}>
			<CatalogHostProvider host={host}>
				<SkillsCatalogSection />
			</CatalogHostProvider>
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Story />);
}
