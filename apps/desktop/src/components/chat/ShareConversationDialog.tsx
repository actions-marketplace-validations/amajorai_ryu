import {
	Cancel01Icon,
	Copy01Icon,
	Globe02Icon,
	InformationCircleIcon,
	LockIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Avatar, AvatarFallback, AvatarImage } from "@ryu/ui/components/avatar";
import { Button } from "@ryu/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ryu/ui/components/select";
import { toast } from "@ryu/ui/components/sileo.tsx";
import { Spinner } from "@ryu/ui/components/spinner";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getActiveUserId, listAccounts } from "@/lib/auth-client.ts";
import type { ApiTarget } from "@/src/lib/api/client.ts";
import {
	type ConversationAccess,
	type ConversationAccessRole,
	getConversationAccess,
	getPrincipalDirectory,
	getPublicShare,
	getPublicSnapshotMessages,
	type PrincipalDirectory,
	type PublicShareStatus,
	publishPublicShare,
	revokePublicShare,
	setConversationAccess,
} from "@/src/lib/api/conversation-sharing.ts";

type GeneralAccess = ConversationAccess["visibility"] | "public";

function initials(name: string): string {
	return (
		name
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? "")
			.join("") || "?"
	);
}

function isGeneralAccess(value: unknown): value is GeneralAccess {
	return ["private", "org", "team", "public"].includes(String(value));
}

function isAccessRole(value: unknown): value is ConversationAccessRole {
	return value === "viewer" || value === "participant";
}

export function ShareConversationDialog({
	conversationId,
	onOpenChange,
	open,
	target,
	title,
}: {
	conversationId: string;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	target: ApiTarget;
	title: string;
}) {
	const activeUserId = getActiveUserId();
	const owner = useMemo(
		() =>
			listAccounts().find((account) => account.userId === activeUserId) ?? null,
		[activeUserId]
	);
	const [access, setAccess] = useState<ConversationAccess | null>(null);
	const [directory, setDirectory] = useState<PrincipalDirectory | null>(null);
	const [generalAccess, setGeneralAccess] = useState<GeneralAccess>("private");
	const [publicShare, setPublicShare] = useState<PublicShareStatus | null>(
		null
	);
	const [personToAdd, setPersonToAdd] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [nextAccess, nextDirectory] = await Promise.all([
				getConversationAccess(target, conversationId),
				getPrincipalDirectory(target).catch(() => ({ members: [], teams: [] })),
			]);
			const nextPublicShare =
				owner && nextAccess.can_manage
					? await getPublicShare(conversationId).catch(() => null)
					: null;
			setAccess(nextAccess);
			setDirectory(nextDirectory);
			setPublicShare(nextPublicShare);
			setGeneralAccess(nextPublicShare ? "public" : nextAccess.visibility);
		} catch (loadError) {
			setError(
				loadError instanceof Error
					? loadError.message
					: "Could not load sharing settings."
			);
		} finally {
			setLoading(false);
		}
	}, [conversationId, owner, target]);

	useEffect(() => {
		if (open) {
			void load();
		}
	}, [load, open]);

	const memberById = useMemo(
		() =>
			new Map(directory?.members.map((member) => [member.id, member]) ?? []),
		[directory]
	);
	const canManage = access?.can_manage ?? false;
	const ownerUserId = access?.owner_user_id ?? activeUserId;
	const ownerMember = ownerUserId ? memberById.get(ownerUserId) : undefined;
	const ownerIsCurrentUser = ownerUserId === activeUserId;
	const ownerName =
		ownerMember?.name ||
		(ownerIsCurrentUser ? owner?.name || owner?.email : ownerUserId) ||
		"Local owner";
	const ownerEmail =
		ownerMember?.email ||
		(ownerIsCurrentUser ? owner?.email : ownerUserId) ||
		"";
	const availableMembers = useMemo(() => {
		const selected = new Set(
			access?.collaborators.map((collaborator) => collaborator.user_id) ?? []
		);
		return (
			directory?.members.filter(
				(member) => member.id !== ownerUserId && !selected.has(member.id)
			) ?? []
		);
	}, [access?.collaborators, directory?.members, ownerUserId]);

	const addPerson = (userId: string | null) => {
		if (!(userId && access)) {
			return;
		}
		setAccess({
			...access,
			collaborators: [
				...access.collaborators,
				{ role: "viewer", user_id: userId },
			],
		});
		setPersonToAdd(null);
	};

	const updateRole = (userId: string, role: ConversationAccessRole) => {
		setAccess((current) =>
			current
				? {
						...current,
						collaborators: current.collaborators.map((collaborator) =>
							collaborator.user_id === userId
								? { ...collaborator, role }
								: collaborator
						),
					}
				: current
		);
	};

	const removePerson = (userId: string) => {
		setAccess((current) =>
			current
				? {
						...current,
						collaborators: current.collaborators.filter(
							(collaborator) => collaborator.user_id !== userId
						),
					}
				: current
		);
	};

	const publish = async (): Promise<PublicShareStatus> => {
		const messages = await getPublicSnapshotMessages(target, conversationId);
		const nextShare = await publishPublicShare(conversationId, title, messages);
		setPublicShare(nextShare);
		return nextShare;
	};

	const copyLink = async () => {
		setSaving(true);
		setError(null);
		try {
			const share = publicShare ?? (await publish());
			await navigator.clipboard.writeText(share.url);
			toast.success("Share link copied");
		} catch (copyError) {
			setError(
				copyError instanceof Error
					? copyError.message
					: "Could not copy the link."
			);
		} finally {
			setSaving(false);
		}
	};

	const refreshPublicCopy = async () => {
		setSaving(true);
		setError(null);
		try {
			await publish();
			toast.success("Shared copy updated");
		} catch (publishError) {
			setError(
				publishError instanceof Error
					? publishError.message
					: "Could not update the shared copy."
			);
		} finally {
			setSaving(false);
		}
	};

	const save = async () => {
		if (!access) {
			return;
		}
		if (!canManage) {
			onOpenChange(false);
			return;
		}
		if (generalAccess === "team" && !access.team_id) {
			setError("Choose a team before saving.");
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const coreAccess: Pick<
				ConversationAccess,
				"collaborators" | "team_id" | "visibility"
			> = {
				collaborators: access.collaborators,
				team_id: generalAccess === "team" ? access.team_id : null,
				visibility: generalAccess === "public" ? "private" : generalAccess,
			};
			if (generalAccess === "public") {
				await setConversationAccess(target, conversationId, coreAccess);
				await publish();
			} else {
				if (owner) {
					await revokePublicShare(conversationId);
				}
				await setConversationAccess(target, conversationId, coreAccess);
				setPublicShare(null);
			}
			toast.success("Sharing settings saved");
			onOpenChange(false);
		} catch (saveError) {
			setError(
				saveError instanceof Error
					? saveError.message
					: "Could not save sharing settings."
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent
				className="max-h-[min(760px,calc(100vh-2rem))] max-w-xl overflow-hidden p-0"
				data-testid="share-conversation-dialog"
			>
				<DialogHeader className="border-b px-6 py-5">
					<DialogTitle className="pr-8 text-lg">Share “{title}”</DialogTitle>
					<DialogDescription>
						Invite people to the live chat or publish a private, frozen copy.
					</DialogDescription>
				</DialogHeader>

				<div className="min-h-0 overflow-y-auto px-6 py-5">
					{loading ? (
						<div className="flex min-h-56 items-center justify-center gap-2 text-muted-foreground text-sm">
							<Spinner /> Loading sharing settings&hellip;
						</div>
					) : error && !access ? (
						<div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
							<p className="font-medium">Sharing is unavailable</p>
							<p className="mt-1 text-muted-foreground">{error}</p>
							<Button
								className="mt-4"
								onClick={() => void load()}
								size="sm"
								variant="outline"
							>
								Try again
							</Button>
						</div>
					) : access ? (
						<div className="space-y-6">
							<section
								aria-labelledby="share-people-heading"
								className="space-y-3"
							>
								<div>
									<h3 className="font-medium text-sm" id="share-people-heading">
										People with access
									</h3>
									<p className="mt-0.5 text-muted-foreground text-xs">
										Viewers can read. Participants can send new messages.
									</p>
								</div>

								{availableMembers.length > 0 ? (
									<Select
										disabled={!canManage}
										onValueChange={(value) =>
											addPerson(typeof value === "string" ? value : null)
										}
										value={personToAdd}
									>
										<SelectTrigger aria-label="Add a person" className="w-full">
											<SelectValue placeholder="Add people" />
										</SelectTrigger>
										<SelectContent>
											{availableMembers.map((member) => (
												<SelectItem key={member.id} value={member.id}>
													<span className="flex min-w-0 flex-col">
														<span className="truncate">{member.name}</span>
														{member.email ? (
															<span className="truncate text-muted-foreground text-xs">
																{member.email}
															</span>
														) : null}
													</span>
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								) : null}

								<div className="divide-y rounded-xl border">
									{ownerUserId || owner ? (
										<div className="flex items-center gap-3 px-3 py-3">
											<Avatar className="size-9">
												{ownerIsCurrentUser && owner?.image ? (
													<AvatarImage alt="" src={owner.image} />
												) : null}
												<AvatarFallback>{initials(ownerName)}</AvatarFallback>
											</Avatar>
											<div className="min-w-0 flex-1">
												<p className="truncate font-medium text-sm">
													{ownerName}
													{ownerIsCurrentUser ? " (you)" : ""}
												</p>
												<p className="truncate text-muted-foreground text-xs">
													{ownerEmail}
												</p>
											</div>
											<span className="text-muted-foreground text-xs">
												Owner
											</span>
										</div>
									) : null}

									{access.collaborators.map((collaborator) => {
										const member = memberById.get(collaborator.user_id);
										const name = member?.name || collaborator.user_id;
										return (
											<div
												className="flex items-center gap-3 px-3 py-3"
												key={collaborator.user_id}
											>
												<Avatar className="size-9">
													<AvatarFallback>{initials(name)}</AvatarFallback>
												</Avatar>
												<div className="min-w-0 flex-1">
													<p className="truncate font-medium text-sm">{name}</p>
													<p className="truncate text-muted-foreground text-xs">
														{member?.email || collaborator.user_id}
													</p>
												</div>
												<Select
													disabled={!canManage}
													onValueChange={(value) => {
														if (isAccessRole(value)) {
															updateRole(collaborator.user_id, value);
														}
													}}
													value={collaborator.role}
												>
													<SelectTrigger
														aria-label={`Role for ${name}`}
														className="w-32"
													>
														<SelectValue>
															{(value) =>
																value === "participant"
																	? "Participant"
																	: "Viewer"
															}
														</SelectValue>
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="viewer">Viewer</SelectItem>
														<SelectItem value="participant">
															Participant
														</SelectItem>
													</SelectContent>
												</Select>
												<Button
													aria-label={`Remove ${name}`}
													disabled={!canManage}
													onClick={() => removePerson(collaborator.user_id)}
													size="icon-sm"
													variant="ghost"
												>
													<HugeiconsIcon
														className="size-4"
														icon={Cancel01Icon}
													/>
												</Button>
											</div>
										);
									})}
								</div>
							</section>

							<section
								aria-labelledby="share-general-heading"
								className="space-y-3"
							>
								<h3 className="font-medium text-sm" id="share-general-heading">
									General access
								</h3>
								<div className="flex items-start gap-3 rounded-xl border p-3">
									<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
										<HugeiconsIcon
											className="size-4"
											icon={generalAccess === "public" ? Globe02Icon : LockIcon}
										/>
									</div>
									<div className="min-w-0 flex-1 space-y-2">
										<Select
											disabled={!canManage}
											onValueChange={(value) => {
												if (isGeneralAccess(value)) {
													setGeneralAccess(value);
												}
											}}
											value={generalAccess}
										>
											<SelectTrigger
												aria-label="General access"
												className="w-full"
											>
												<SelectValue>
													{(value) => {
														switch (value) {
															case "org":
																return "Anyone in the organization";
															case "team":
																return "A team";
															case "public":
																return "Anyone with the link";
															default:
																return "Restricted";
														}
													}}
												</SelectValue>
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="private">Restricted</SelectItem>
												{directory?.org_id ? (
													<SelectItem value="org">
														Anyone in the organization
													</SelectItem>
												) : null}
												{directory?.teams.length ? (
													<SelectItem value="team">A team</SelectItem>
												) : null}
												<SelectItem
													disabled={!(owner && canManage)}
													value="public"
												>
													Anyone with the link
												</SelectItem>
											</SelectContent>
										</Select>

										{generalAccess === "team" ? (
											<Select
												disabled={!canManage}
												onValueChange={(value) =>
													setAccess({
														...access,
														team_id: typeof value === "string" ? value : null,
													})
												}
												value={access.team_id}
											>
												<SelectTrigger aria-label="Team" className="w-full">
													<SelectValue placeholder="Choose a team">
														{(value) =>
															directory?.teams.find((team) => team.id === value)
																?.name ?? "Choose a team"
														}
													</SelectValue>
												</SelectTrigger>
												<SelectContent>
													{directory?.teams.map((team) => (
														<SelectItem key={team.id} value={team.id}>
															{team.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										) : null}
										<p className="text-muted-foreground text-xs">
											{canManage
												? generalAccess === "private"
													? "Only invited people can open the live chat."
													: null
												: "Only the owner or an organization admin can change access."}
											{generalAccess === "org"
												? "Everyone in your organization can participate."
												: null}
											{generalAccess === "team"
												? "Members of the selected team can participate."
												: null}
											{generalAccess === "public"
												? "Anyone with the URL can view a frozen copy without signing in."
												: null}
										</p>
									</div>
								</div>

								{generalAccess === "public" ? (
									<div className="flex gap-2 rounded-lg bg-primary/8 p-3 text-xs">
										<HugeiconsIcon
											className="mt-0.5 size-4 shrink-0 text-primary"
											icon={InformationCircleIcon}
										/>
										<p>
											Your name, tool activity, files, and messages added later
											are not included. Use Update copy to publish the current
											transcript again.
										</p>
									</div>
								) : null}
							</section>

							{error ? (
								<p
									aria-live="polite"
									className="text-destructive text-sm"
									role="alert"
								>
									{error}
								</p>
							) : null}
						</div>
					) : null}
				</div>

				<DialogFooter className="flex-row items-center justify-between border-t px-6 py-4 sm:justify-between">
					<div className="flex items-center gap-2">
						{generalAccess === "public" && access ? (
							<>
								<Button
									disabled={saving || !canManage}
									onClick={() => void copyLink()}
									variant="outline"
								>
									<HugeiconsIcon className="mr-2 size-4" icon={Copy01Icon} />{" "}
									Copy link
								</Button>
								{publicShare ? (
									<Button
										disabled={saving || !canManage}
										onClick={() => void refreshPublicCopy()}
										variant="ghost"
									>
										Update copy
									</Button>
								) : null}
							</>
						) : null}
					</div>
					<div className="flex items-center gap-2">
						<Button
							disabled={saving}
							onClick={() => onOpenChange(false)}
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={loading || saving || !access}
							onClick={() => void save()}
						>
							{saving ? (
								<>
									<Spinner className="mr-2" /> Saving
								</>
							) : (
								"Done"
							)}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
