import { Button } from "@ryu/ui/components/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog.tsx";
import { Label } from "@ryu/ui/components/label.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "@ryu/ui/components/native-select.tsx";
import { Textarea } from "@ryu/ui/components/textarea.tsx";
import {
	createRnpContextBundle,
	normalizeRnpNodeUrl,
	parseRnpContinuityBundle,
	type RnpContinuityBundleV0,
	type RnpResumeResultV0,
} from "@ryuhq/protocol/continuity";
import { buildRyuDeepLink } from "@ryuhq/protocol/deep-link";
import { useEffect, useMemo, useState } from "react";
import { toTarget } from "@/src/lib/api/client.ts";
import {
	exportRnpConversation,
	resumeRnpConversation,
} from "@/src/lib/api/continuity.ts";
import type { Node } from "@/src/store/useNodeStore.ts";

export interface ContinueOnNodeDialogProps {
	conversationId: string;
	conversationTitle: string;
	nodes: readonly Node[];
	onCompleted: (node: Node, result: RnpResumeResultV0) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	resolveNodes?: () => readonly Node[];
	sourceNode: Node;
	sourceUpdatedAt?: number;
}

function errorMessage(error: unknown): string {
	return error instanceof Error
		? error.message
		: "The handoff could not finish.";
}

function sameNode(left: Node, right: Node): boolean {
	return normalizeRnpNodeUrl(left.url) === normalizeRnpNodeUrl(right.url);
}

function currentNode(
	reference: Node,
	nodes: readonly Node[]
): Node | undefined {
	return nodes.find((node) => sameNode(node, reference));
}

function buildResumeBundle(
	preview: RnpContinuityBundleV0,
	contextNote: string,
	includeAgentHint: boolean
): RnpContinuityBundleV0 {
	const context = contextNote
		? createRnpContextBundle({
				items: [
					{
						id: "operator-note",
						kind: "text",
						label: "Operator note",
						mediaType: "text/plain",
						text: contextNote,
						source: { kind: "manual" },
					},
				],
			})
		: { version: 0 as const, items: [] };
	const source = includeAgentHint
		? preview.source
		: {
				conversationId: preview.source.conversationId,
				updatedAt: preview.source.updatedAt,
				...(preview.source.checkpointMessageId
					? { checkpointMessageId: preview.source.checkpointMessageId }
					: {}),
				...(preview.source.title ? { title: preview.source.title } : {}),
			};
	const parsed = parseRnpContinuityBundle({ ...preview, source, context });
	if (!parsed.ok) {
		throw new Error(`The reviewed handoff is invalid: ${parsed.error.message}`);
	}
	return parsed.value;
}

export function ContinueOnNodeDialog({
	conversationId,
	conversationTitle,
	nodes,
	onCompleted,
	onOpenChange,
	open,
	resolveNodes,
	sourceNode,
	sourceUpdatedAt,
}: ContinueOnNodeDialogProps) {
	const destinations = useMemo(
		() => nodes.filter((node) => !sameNode(node, sourceNode)),
		[nodes, sourceNode]
	);
	const [selectedName, setSelectedName] = useState("");
	const [contextNote, setContextNote] = useState("");
	const [includeAgentHint, setIncludeAgentHint] = useState(false);
	const [preview, setPreview] = useState<RnpContinuityBundleV0 | null>(null);
	const [attemptedBundle, setAttemptedBundle] =
		useState<RnpContinuityBundleV0 | null>(null);
	const [previewPending, setPreviewPending] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!open) {
			return;
		}
		setSelectedName((current) =>
			destinations.some((node) => node.name === current)
				? current
				: (destinations[0]?.name ?? "")
		);
	}, [destinations, open]);

	useEffect(() => {
		if (!open) {
			return;
		}
		let cancelled = false;
		setPreview(null);
		setAttemptedBundle(null);
		setContextNote("");
		setIncludeAgentHint(false);
		setError(null);
		setCopied(false);
		setPreviewPending(true);

		const availableNodes = resolveNodes?.() ?? nodes;
		const currentSource = currentNode(sourceNode, availableNodes);
		if (!currentSource) {
			setError("The source node is no longer configured.");
			setPreviewPending(false);
			return;
		}
		void exportRnpConversation(toTarget(currentSource), conversationId, {
			version: 0,
			ifUpdatedAt: sourceUpdatedAt,
			transcript: { mode: "recent", maxMessages: 50 },
			includeAgentHint: true,
		})
			.then((bundle) => {
				if (!cancelled) {
					setPreview(bundle);
				}
			})
			.catch((cause: unknown) => {
				if (!cancelled) {
					setError(errorMessage(cause));
				}
			})
			.finally(() => {
				if (!cancelled) {
					setPreviewPending(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [conversationId, nodes, open, resolveNodes, sourceNode, sourceUpdatedAt]);

	const locked = pending || attemptedBundle !== null;
	const handleContinue = async () => {
		if (!preview) {
			return;
		}
		const availableNodes = resolveNodes?.() ?? nodes;
		const currentSource = currentNode(sourceNode, availableNodes);
		const destination = availableNodes.find(
			(node) => node.name === selectedName && !sameNode(node, sourceNode)
		);
		if (!(currentSource && destination)) {
			setError("The source or destination node is no longer configured.");
			return;
		}
		setPending(true);
		setError(null);
		try {
			const bundle =
				attemptedBundle ??
				buildResumeBundle(preview, contextNote.trim(), includeAgentHint);
			if (!attemptedBundle) {
				setAttemptedBundle(bundle);
			}
			const result = await resumeRnpConversation(toTarget(destination), bundle);
			await onCompleted(destination, result);
			onOpenChange(false);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setPending(false);
		}
	};

	const handleCopyLink = async () => {
		setError(null);
		try {
			const link = buildRyuDeepLink({
				kind: "handoff",
				version: 0,
				conversationId,
				sourceNodeUrl: sourceNode.url,
			});
			await navigator.clipboard.writeText(link);
			setCopied(true);
		} catch (cause) {
			setError(errorMessage(cause));
		}
	};

	const reviewedTitle = preview?.source.title ?? conversationTitle;

	return (
		<Dialog
			onOpenChange={(nextOpen) => {
				if (!(pending && !nextOpen)) {
					onOpenChange(nextOpen);
				}
			}}
			open={open}
		>
			<DialogContent className="gap-5 sm:max-w-[36rem]">
				<DialogHeader>
					<DialogTitle>Continue on another node</DialogTitle>
					<DialogDescription>
						Review the exact visible transcript from {sourceNode.name} before
						copying it. Node credentials, structured authentication data, files,
						tool state, workspace paths, and the running agent session stay
						behind.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-4">
					<div className="grid gap-2">
						<Label htmlFor="rnp-destination-node">Destination node</Label>
						<NativeSelect
							className="w-full"
							disabled={destinations.length === 0 || locked}
							id="rnp-destination-node"
							onChange={(event) => setSelectedName(event.target.value)}
							value={selectedName}
						>
							{destinations.length === 0 ? (
								<NativeSelectOption value="">
									No other configured node
								</NativeSelectOption>
							) : (
								destinations.map((node) => (
									<NativeSelectOption key={node.name} value={node.name}>
										{node.name}
									</NativeSelectOption>
								))
							)}
						</NativeSelect>
					</div>

					<div className="grid gap-2">
						<div className="flex items-center justify-between gap-3">
							<Label>Reviewed transcript</Label>
							<span className="text-muted-foreground text-xs">
								{preview ? `${preview.messages.length} messages` : "Loading…"}
							</span>
						</div>
						<div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border bg-muted/30 p-3">
							{previewPending ? (
								<p className="text-muted-foreground text-sm">
									Loading the reviewed snapshot…
								</p>
							) : (
								preview?.messages.map((message) => (
									<div className="text-sm" key={message.sourceId}>
										<p className="font-medium text-muted-foreground text-xs uppercase">
											{message.role}
										</p>
										<p className="whitespace-pre-wrap break-words">
											{message.text}
										</p>
									</div>
								))
							)}
						</div>
						<p className="text-muted-foreground text-xs">
							“{reviewedTitle}” from {sourceNode.name}
							{preview?.selection.omittedEarlierMessages
								? "; earlier messages are omitted"
								: "; no earlier visible messages are omitted"}
							. Visible messages can contain pasted secrets, so review them
							before continuing.
						</p>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="rnp-context-note">Context note (optional)</Label>
						<Textarea
							disabled={locked}
							id="rnp-context-note"
							maxLength={8000}
							onChange={(event) => setContextNote(event.target.value)}
							placeholder="Add a short, visible note for the next node"
							value={contextNote}
						/>
						<p className="text-muted-foreground text-xs">
							The destination saves this as a visible user message, never as a
							hidden system instruction.
						</p>
					</div>

					<label className="flex items-start gap-3 text-sm">
						<input
							checked={includeAgentHint}
							className="mt-0.5 size-4 accent-foreground"
							disabled={locked}
							onChange={(event) => setIncludeAgentHint(event.target.checked)}
							type="checkbox"
						/>
						<span>
							Suggest the same agent if it exists on the destination. The target
							node still decides which installed agent can run.
						</span>
					</label>

					{error ? (
						<p
							className="rounded-xl bg-destructive/10 px-3 py-2 text-destructive text-sm"
							role="alert"
						>
							{error}
						</p>
					) : null}
				</div>

				<DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
					<Button
						disabled={pending}
						onClick={() => void handleCopyLink()}
						variant="ghost"
					>
						{copied ? "Handoff link copied" : "Copy handoff link"}
					</Button>
					<Button
						disabled={!(preview && selectedName) || pending}
						onClick={() => void handleContinue()}
					>
						{pending
							? "Moving reviewed context…"
							: attemptedBundle
								? "Retry same handoff"
								: "Continue on selected node"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
