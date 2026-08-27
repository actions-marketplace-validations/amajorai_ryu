import {
	renderTemplate,
	type SidebarSectionSpec,
	type SourceItem,
} from "@ryu/app-host/views";
import { Icon } from "@ryu/ui/components/icon.tsx";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@ryu/ui/components/sidebar.tsx";
import { useMemo } from "react";
import {
	pluginCompanionPath,
	usePluginContributions,
} from "@/src/hooks/usePluginContributions.ts";
import { useSidebarSectionSources } from "@/src/hooks/useSidebarSectionSource.ts";
import type {
	PluginSidebarButton,
	PluginSidebarSection,
} from "@/src/lib/api/plugins.ts";

export interface StandaloneAppNavigation {
	context?: Record<string, unknown>;
	target: string;
}

function rowContext(
	spec: SidebarSectionSpec | undefined,
	row: SourceItem
): Record<string, unknown> | undefined {
	if (!spec?.context) {
		return undefined;
	}
	const context: Record<string, unknown> = {};
	for (const [key, rowKey] of Object.entries(spec.context)) {
		const value = row.raw[rowKey];
		if (value !== undefined && value !== null) {
			context[key] = value;
		}
	}
	return Object.keys(context).length > 0 ? context : undefined;
}

function rowTarget(
	section: PluginSidebarSection,
	row: SourceItem,
	homeTarget: string
): string {
	const target = section.spec?.itemTarget;
	return target
		? renderTemplate(target, { item: row.raw }, { uriEncode: true })
		: homeTarget;
}

function queryContext(target: string): Record<string, unknown> | undefined {
	const query = target.split("?", 2)[1];
	if (!query) {
		return undefined;
	}
	const context = Object.fromEntries(new URLSearchParams(query));
	return Object.keys(context).length > 0 ? context : undefined;
}

function ordered<T extends { order?: number }>(items: T[]): T[] {
	return [...items].sort(
		(left, right) => (left.order ?? 0) - (right.order ?? 0)
	);
}

function ContributedSection({
	data,
	homeTarget,
	onNavigate,
}: {
	data: ReturnType<typeof useSidebarSectionSources>[number];
	homeTarget: string;
	onNavigate: (navigation: StandaloneAppNavigation) => void;
}) {
	const { contribution, rows } = data;
	const spec = contribution.spec;
	if (rows.length === 0 && !data.isLoading && !spec?.emptyState) {
		return null;
	}
	return (
		<SidebarGroup>
			<SidebarGroupLabel>
				{contribution.icon ? <Icon icon={contribution.icon} size={14} /> : null}
				<span>{contribution.title}</span>
			</SidebarGroupLabel>
			<SidebarGroupContent>
				<SidebarMenu>
					{data.isLoading ? (
						<SidebarMenuItem>
							<span className="px-3 py-2 text-muted-foreground text-xs">
								Loading…
							</span>
						</SidebarMenuItem>
					) : rows.length === 0 ? (
						<SidebarMenuItem>
							<span className="px-3 py-2 text-muted-foreground text-xs">
								{spec?.emptyState?.title ?? "No items yet"}
							</span>
						</SidebarMenuItem>
					) : (
						rows.map((row) => {
							const target = rowTarget(contribution, row, homeTarget);
							return (
								<SidebarMenuItem key={row.item.id}>
									<SidebarMenuButton
										onClick={() =>
											onNavigate({
												context: rowContext(spec, row),
												target,
											})
										}
										title={row.item.title}
									>
										{contribution.icon ? (
											<Icon
												icon={row.item.icon ?? contribution.icon}
												size={16}
											/>
										) : null}
										<span>{row.item.title}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							);
						})
					)}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}

export function StandaloneAppSidebar({
	appId,
	onNavigate,
}: {
	appId: string;
	onNavigate: (navigation: StandaloneAppNavigation) => void;
}) {
	const { companions, sidebar_buttons, sidebar_sections } =
		usePluginContributions();
	const companion = companions.find((item) => item.pluginId === appId);
	const homeTarget = companion ? pluginCompanionPath(companion.id) : "/";
	const sections = useMemo(
		() =>
			ordered(sidebar_sections.filter((section) => section.plugin === appId)),
		[appId, sidebar_sections]
	);
	const buttons = useMemo(
		() => ordered(sidebar_buttons.filter((button) => button.plugin === appId)),
		[appId, sidebar_buttons]
	);
	const sectionData = useSidebarSectionSources(sections);
	const appName = companion?.label || companion?.name || "Ryu App";

	return (
		<Sidebar collapsible="none" variant="sidebar">
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							isActive
							onClick={() => onNavigate({ target: homeTarget })}
						>
							{companion?.icon ? (
								<Icon icon={companion.icon} size={16} />
							) : null}
							<span>{appName}</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				{buttons.length > 0 ? (
					<SidebarGroup>
						<SidebarGroupContent>
							<SidebarMenu>
								{buttons.map((button: PluginSidebarButton) => (
									<SidebarMenuItem key={button.id}>
										<SidebarMenuButton
											onClick={() =>
												onNavigate({
													context:
														button.context ?? queryContext(button.target),
													target: button.target,
												})
											}
										>
											{button.icon ? (
												<Icon icon={button.icon} size={16} />
											) : null}
											<span>{button.title}</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								))}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				) : null}
				{sectionData.map((data) => (
					<ContributedSection
						data={data}
						homeTarget={homeTarget}
						key={`${data.contribution.plugin}:${data.contribution.id}`}
						onNavigate={onNavigate}
					/>
				))}
			</SidebarContent>
			<SidebarFooter>
				<span className="px-3 py-2 text-muted-foreground text-xs">
					Ryu app navigation
				</span>
			</SidebarFooter>
		</Sidebar>
	);
}
