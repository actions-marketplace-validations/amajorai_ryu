// The workspace UGC panel: a creator-marketing campaign tracker driven entirely
// by the `@ryu/ugc` app's sidecar.
//
// This is a `panel: "native"` dock contribution (the `@ryu/browser` /
// `@ryu/simulator` precedent), not a sandboxed companion: a companion frame runs
// under CSP `connect-src 'none'` and could only reach the sidecar through per-app
// RPC verbs in Core, which is exactly the per-app coupling an apps-store satellite
// must not require. A native panel just fetches the sidecar's public mount.
//
// Data path: `/api/ugc/*` DIRECTLY. The app's manifest declares `http.public_mount`,
// so Core mounts the sidecar at that prefix and the longer `/api/ext/@ryu/ugc/*`
// form the Browser panel uses (its manifest declares no public mount) is not needed
// here. Every path below must also appear in the manifest's `http.routes[]` — Core's
// ext-proxy 404s an undeclared path before it ever reaches the sidecar.
//
// Money is integer cents on the wire and stays integer until `formatCents` divides
// once at the render edge. No currency arithmetic happens in floats.

import {
	Alert01Icon,
	ChartLineData01Icon,
	Coins01Icon,
	LinkSquare01Icon,
	Megaphone01Icon,
	PlugSocketIcon,
	PlusSignIcon,
	RefreshIcon,
	Settings01Icon,
	UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@ryu/ui/components/alert-dialog.tsx";
import { Badge } from "@ryu/ui/components/badge.tsx";
import { Button } from "@ryu/ui/components/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ryu/ui/components/dialog.tsx";
import { Input } from "@ryu/ui/components/input.tsx";
import { Label } from "@ryu/ui/components/label.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "@ryu/ui/components/native-select.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@ryu/ui/components/table.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@ryu/ui/components/tabs.tsx";
import { Textarea } from "@ryu/ui/components/textarea.tsx";
import { cn } from "@ryu/ui/lib/utils.ts";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useActiveNode } from "@/src/hooks/useActiveNode.ts";
import { useApps } from "@/src/hooks/useApps.ts";
import { apiUrl, makeHeaders } from "@/src/lib/api/client.ts";
import { formatDate as formatDateInZone } from "@/src/lib/timezone.ts";

/** The app that owns this panel. Feature detection keys off it, so a disabled
 *  app renders an enable hint instead of hammering a sidecar that is not there. */
const UGC_PLUGIN_ID = "@ryu/ugc";

/** The sidecar's public mount. Every path below is relative to this. */
const UGC_BASE = "/api/ugc";

/** Server caps this too; asking for a sane page keeps the panel snappy. */
const LEADERBOARD_LIMIT = 10;

// ── Wire types ───────────────────────────────────────────────────────────────
// Snake_case because that is what the sidecar serializes. Optional fields are
// optional on purpose: this panel degrades to "—" rather than crashing when the
// sidecar is a version ahead of or behind this build.

type CampaignStatus = "draft" | "active" | "paused" | "ended";
type SubmissionStatus = "pending" | "approved" | "rejected" | "paid";
type PayoutStatus = "accrued" | "approved" | "paid";

/** Externally tagged, exactly as the sidecar's `PayoutRule` serializes. */
type PayoutRule =
	| { cpm_cents: number; type: "cpm" }
	| { flat_cents: number; type: "flat" };

interface Campaign {
	brand: string;
	brief?: string;
	budget_cents: number;
	ends_at?: string | null;
	id: string;
	/** Read back and DISPLAYED, not just round-tripped: the rule decides every
	 *  accrual, so an operator must be able to see it without opening the API. */
	payout?: PayoutRule;
	platforms?: string[];
	starts_at?: string | null;
	status: CampaignStatus;
}

interface CampaignSummary {
	accrued_cents: number;
	approved_cents: number;
	budget_cents: number;
	creators: number;
	paid_cents: number;
	/** `budget_cents - committed_cents`, floored at 0 — and NULL, not 0, when the
	 *  campaign is uncapped (`budget_cents == 0`). The sidecar serializes an
	 *  `Option<i64>` here with no `skip_serializing_if`, so the key is always
	 *  present and "unlimited" arrives as an explicit `null`. */
	remaining_cents: number | null;
	submissions: Record<SubmissionStatus, number>;
	total_comments: number;
	total_likes: number;
	total_views: number;
}

interface MetricSnapshot {
	captured_at: string;
	comments: number;
	likes: number;
	saves: number;
	shares: number;
	source: "composio" | "manual";
	views: number;
}

interface Submission {
	/** What this post has accrued, from the payout row the list read joins in.
	 *  NULL means no payout has accrued at all — a distinct fact from a real
	 *  zero, which an unpriced campaign or a zero-view post genuinely produces.
	 *  Optional as well as nullable because a sidecar older than this build does
	 *  not send the key; that degrades to "—" exactly like a null. */
	accrued_cents?: number | null;
	campaign_id: string;
	creator_id: string;
	external_post_id?: string;
	id: string;
	latest?: MetricSnapshot | null;
	/** The joined payout row's state, so the row says whether that money is still
	 *  accruing, cleared for payment, or already paid. Null alongside a null
	 *  `accrued_cents`. */
	payout_status?: PayoutStatus | null;
	platform: string;
	post_url: string;
	rejection_reason?: string | null;
	status: SubmissionStatus;
	submitted_at: string;
}

interface Creator {
	contact_email?: string | null;
	display_name: string;
	id: string;
}

interface LeaderboardRow {
	accrued_cents: number;
	approved_submissions: number;
	creator_id: string;
	display_name?: string;
	paid_cents: number;
	views: number;
}

interface Payout {
	amount_cents: number;
	campaign_id: string;
	creator_id: string;
	id: string;
	reason?: string;
	status: PayoutStatus;
	submission_id?: string | null;
}

/** One row of the sidecar's curated Composio action map, served verbatim by
 *  `GET /api/ugc/platforms`. The panel uses it for labels and to say honestly
 *  which platforms can auto-refresh at all. */
interface PlatformSource {
	action: string;
	label: string;
	platform: string;
}

/** The three answers a refresh gives about ONE submission.
 *
 *  `needs_connection` is a SUCCESS the operator can act on, not a failure: the
 *  account behind that platform is not linked to this node's Composio entity yet,
 *  so there were no counters to read. The sidecar writes nothing on that branch —
 *  no snapshot, no re-priced payout — which is why it can never be folded into
 *  the refreshed count. */
type RefreshStatus = "error" | "needs_connection" | "ok";

/** One submission's line in a refresh response. Both refresh routes report this
 *  identical shape, and the sidecar serializes `message`/`connect_url`/`snapshot`
 *  as explicit nulls rather than skipping them, so the panel switches on `status`
 *  instead of probing for keys. Optional here anyway: a sidecar a version behind
 *  this build may not send them at all. */
interface SubmissionRefreshReport {
	connect_url?: string | null;
	message?: string | null;
	snapshot?: MetricSnapshot | null;
	status: RefreshStatus;
	submission_id: string;
}

/** The campaign-level split, counted by the sidecar. `needs_connection` is
 *  counted apart from `error` because the two need different things done about
 *  them — link an account versus read what broke. */
interface RefreshCounts {
	error: number;
	needs_connection: number;
	ok: number;
}

/** Where the Composio API key this app refreshes with comes from. `app` is the
 *  one the operator saved here; `env` is this node's environment. */
type ComposioKeySource = "app" | "env" | "none";

/** `GET /api/ugc/settings`. The key itself is write-only on the wire — no route
 *  returns it, a prefix of it, or its length — so there is nothing to render but
 *  these two derived facts. */
interface UgcSettings {
	composio_configured: boolean;
	composio_key_source: ComposioKeySource;
}

/** The bare mount's cross-campaign rollup, served by `GET /api/ugc`. */
interface UgcOverview {
	accrued_cents: number;
	campaigns: number;
	creators: number;
	paid_cents: number;
	submissions: Record<SubmissionStatus, number>;
}

// ── Formatting ───────────────────────────────────────────────────────────────

const USD_FORMATTER = new Intl.NumberFormat(undefined, {
	currency: "USD",
	style: "currency",
});

const COUNT_FORMATTER = new Intl.NumberFormat();

/** Integer cents in, display string out. This single division is the ONLY place
 *  money touches a float, and it happens after all arithmetic is done. A field
 *  the sidecar did not send renders as "—" rather than "$NaN". */
function formatCents(cents: number): string {
	if (!Number.isFinite(cents)) {
		return "—";
	}
	return USD_FORMATTER.format(cents / 100);
}

function formatCount(value: number): string {
	if (!Number.isFinite(value)) {
		return "—";
	}
	return COUNT_FORMATTER.format(value);
}

function formatDate(iso: string | null | undefined): string {
	if (!iso) {
		return "—";
	}
	const parsed = new Date(iso);
	if (Number.isNaN(parsed.getTime())) {
		return iso;
	}
	return formatDateInZone(parsed);
}

/** Accepts `12`, `12.5`, `$12.50`. Returns integer cents, or null when the text
 *  is not a money amount — parsed digit-wise so a typed amount never round-trips
 *  through a float. */
const DOLLARS_RE = /^\s*\$?\s*(\d+)(?:\.(\d{1,2}))?\s*$/;

function dollarsToCents(input: string): number | null {
	const match = DOLLARS_RE.exec(input);
	if (!match) {
		return null;
	}
	const whole = Number.parseInt(match[1], 10);
	const fraction = (match[2] ?? "").padEnd(2, "0");
	return whole * 100 + Number.parseInt(fraction, 10);
}

/** A counter is a whole number of people, not money, so it never goes through
 *  `dollarsToCents`. Digit-only on purpose: `1e4`, `12.5` and `1,200` all parse
 *  to something under `Number.parseInt` that is not what was typed, and the
 *  sidecar rejects a negative with a 400 rather than storing it. A blank box is
 *  0 — the POST appends a whole snapshot, so there is no "leave this one alone". */
const COUNT_RE = /^\d{1,15}$/;

function parseCount(input: string): number | null {
	const trimmed = input.trim();
	if (trimmed === "") {
		return 0;
	}
	if (!COUNT_RE.test(trimmed)) {
		return null;
	}
	return Number.parseInt(trimmed, 10);
}

/** The campaign's pricing rule in words. A campaign the sidecar priced at zero
 *  says so out loud — that is the state a mis-sent rule leaves behind, and it is
 *  invisible if the panel only ever shows the resulting $0.00 accruals. */
function formatPayoutRule(rule: PayoutRule | undefined): string {
	if (!rule) {
		return "No payout rule";
	}
	return rule.type === "cpm"
		? `${formatCents(rule.cpm_cents)} per 1,000 views`
		: `${formatCents(rule.flat_cents)} per approved post`;
}

/** Spend as a whole percentage of budget, in integer cents. A 0 budget means
 *  "uncapped" in this app's schema, so there is no percentage to show. */
function spendPercent(spentCents: number, budgetCents: number): number | null {
	if (budgetCents <= 0) {
		return null;
	}
	return Math.min(100, Math.round((spentCents * 100) / budgetCents));
}

// ── Transport ────────────────────────────────────────────────────────────────

/** Pull the sidecar's own message out of a failed response.
 *
 *  The Browser panel throws the bare status code because its only failure mode is
 *  "sidecar unreachable". Ours has failures the operator must read: a 409 for a
 *  post already submitted to this campaign, a 409 for approving an already-paid
 *  payout, a 400 for a platform with no curated Composio source, a 502 carrying
 *  Composio's own error. Swallowing those into "409" would be a fake explanation. */
function errorMessage(body: string, status: number): string {
	const fallback = body.trim() || `Request failed (${status})`;
	try {
		const parsed = JSON.parse(body) as { error?: string; message?: string };
		return parsed.error ?? parsed.message ?? fallback;
	} catch {
		return fallback;
	}
}

/** Read a list out of a response that may be either a bare array or the usual
 *  `{ <key>: [...] }` envelope. The sidecar ships separately from this panel; a
 *  shape mismatch should render an empty table, not throw inside React. */
function listOf<T>(data: unknown, key: string): T[] {
	if (Array.isArray(data)) {
		return data as T[];
	}
	if (data && typeof data === "object") {
		const value = (data as Record<string, unknown>)[key];
		if (Array.isArray(value)) {
			return value as T[];
		}
	}
	return [];
}

type UgcCall = <T>(path: string, init?: RequestInit) => Promise<T>;

/** The one fetch seam, mirroring `BrowserSidecarPanel`'s: resolve the active node,
 *  attach its bearer, join the path onto the node URL. */
function useUgcCall(): UgcCall {
	const node = useActiveNode();
	const url = node.url;
	const token = node.token ?? null;
	const headers = useMemo(() => makeHeaders(token), [token]);
	return useCallback(
		async <T,>(path: string, init?: RequestInit): Promise<T> => {
			const resp = await fetch(apiUrl({ token, url }, `${UGC_BASE}${path}`), {
				headers,
				...init,
			});
			const text = await resp.text();
			if (!resp.ok) {
				throw new Error(errorMessage(text, resp.status));
			}
			return (text ? JSON.parse(text) : {}) as T;
		},
		[headers, token, url]
	);
}

function describeError(err: unknown): string {
	return err instanceof Error ? err.message : "Request failed";
}

// ── Refresh + settings readers ───────────────────────────────────────────────

const COMPOSIO_KEY_SOURCES: readonly ComposioKeySource[] = [
	"app",
	"env",
	"none",
];

/** Read the settings body, or null when the sidecar did not answer one this
 *  build understands.
 *
 *  Null means "unknown", and the panel then says nothing at all about the key —
 *  a sidecar older than this build has no `/settings` route, and guessing a
 *  source would put words in its mouth. */
function readSettings(data: unknown): UgcSettings | null {
	if (!data || typeof data !== "object") {
		return null;
	}
	const row = data as {
		composio_configured?: unknown;
		composio_key_source?: unknown;
	};
	const source = COMPOSIO_KEY_SOURCES.find(
		(candidate) => candidate === row.composio_key_source
	);
	if (typeof row.composio_configured !== "boolean" || !source) {
		return null;
	}
	return {
		composio_configured: row.composio_configured,
		composio_key_source: source,
	};
}

const REFRESH_STATUSES: readonly RefreshStatus[] = [
	"error",
	"needs_connection",
	"ok",
];

/** Normalize one report line.
 *
 *  A status this build does not know is reported as `error` carrying whatever
 *  message came with it: it is certainly not a reading and certainly not a
 *  connect prompt, and dropping the row would quietly move a submission that did
 *  nothing into the refreshed count. */
function readRefreshRow(row: SubmissionRefreshReport): SubmissionRefreshReport {
	return REFRESH_STATUSES.includes(row.status)
		? row
		: { ...row, status: "error" };
}

function isRefreshCounts(value: unknown): value is RefreshCounts {
	if (!value || typeof value !== "object") {
		return false;
	}
	const counts = value as Record<string, unknown>;
	return (
		typeof counts.ok === "number" &&
		typeof counts.needs_connection === "number" &&
		typeof counts.error === "number"
	);
}

/** Tally the rows this panel is about to render. Used when the sidecar sent no
 *  well-formed `counts`, so the summary line can never disagree with the list
 *  underneath it. */
function tallyRefresh(results: SubmissionRefreshReport[]): RefreshCounts {
	const counts: RefreshCounts = { error: 0, needs_connection: 0, ok: 0 };
	for (const row of results) {
		if (row.status === "ok") {
			counts.ok += 1;
		} else if (row.status === "needs_connection") {
			counts.needs_connection += 1;
		} else {
			counts.error += 1;
		}
	}
	return counts;
}

/** What a refresh run actually did, in words, from the real three-way split.
 *
 *  Never "refreshed 12 submissions" when 4 of those 12 wrote nothing: an
 *  unlinked account and a read that failed are separate outcomes with separate
 *  fixes, so both are named. */
function describeRefreshCounts(counts: RefreshCounts): string {
	const parts = [`${counts.ok} refreshed`];
	if (counts.needs_connection > 0) {
		parts.push(
			`${counts.needs_connection} need${
				counts.needs_connection === 1 ? "s" : ""
			} a connection`
		);
	}
	if (counts.error > 0) {
		parts.push(`${counts.error} failed`);
	}
	return parts.join(" · ");
}

// ── Small shared pieces ──────────────────────────────────────────────────────

const CAMPAIGN_STATUS_VARIANT: Record<
	CampaignStatus,
	"default" | "destructive" | "outline" | "secondary"
> = {
	active: "default",
	draft: "outline",
	ended: "secondary",
	paused: "secondary",
};

const SUBMISSION_STATUS_VARIANT: Record<
	SubmissionStatus,
	"default" | "destructive" | "outline" | "secondary"
> = {
	approved: "default",
	paid: "secondary",
	pending: "outline",
	rejected: "destructive",
};

const PAYOUT_STATUS_VARIANT: Record<
	PayoutStatus,
	"default" | "destructive" | "outline" | "secondary"
> = {
	accrued: "outline",
	approved: "default",
	paid: "secondary",
};

function StatusPill({
	label,
	variant,
}: {
	label: string;
	variant: "default" | "destructive" | "outline" | "secondary";
}) {
	return (
		<Badge className="capitalize" variant={variant}>
			{label}
		</Badge>
	);
}

function StatTile({
	hint,
	label,
	value,
}: {
	hint?: string;
	label: string;
	value: string;
}) {
	return (
		<div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
			<div className="text-[11px] text-muted-foreground uppercase tracking-wide">
				{label}
			</div>
			<div className="font-heading font-medium text-sm tabular-nums">
				{value}
			</div>
			{hint ? (
				<div className="text-[11px] text-muted-foreground">{hint}</div>
			) : null}
		</div>
	);
}

/** Spend against budget. An uncapped campaign gets the amount and an honest
 *  "no budget cap" rather than a bar that would imply a ceiling. */
function SpendBar({
	budgetCents,
	spentCents,
}: {
	budgetCents: number;
	spentCents: number;
}) {
	const pct = spendPercent(spentCents, budgetCents);
	if (pct === null) {
		return (
			<span className="text-[11px] text-muted-foreground">
				<span className="font-heading tabular-nums">
					{formatCents(spentCents)}
				</span>{" "}
				spent · no budget cap
			</span>
		);
	}
	return (
		<span className="flex items-center gap-2">
			<span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
				<span
					className={cn(
						"block h-full rounded-full",
						pct >= 100 ? "bg-destructive" : "bg-primary"
					)}
					style={{ width: `${pct}%` }}
				/>
			</span>
			<span className="shrink-0 font-heading text-[11px] text-muted-foreground tabular-nums">
				{formatCents(spentCents)} / {formatCents(budgetCents)}
			</span>
		</span>
	);
}

function PanelNotice({
	children,
	tone = "muted",
}: {
	children: ReactNode;
	tone?: "error" | "muted";
}) {
	return (
		<p
			className={cn(
				"px-3 py-2 text-xs",
				tone === "error" ? "text-destructive" : "text-muted-foreground"
			)}
		>
			{children}
		</p>
	);
}

function LoadingRow({ text = "Loading…" }: { text?: string }) {
	return (
		<div className="flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs">
			<Spinner className="size-3.5" />
			<span>{text}</span>
		</div>
	);
}

function ErrorBanner({ message }: { message: string }) {
	return (
		<div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-xs">
			<HugeiconsIcon className="mt-px size-3.5 shrink-0" icon={Alert01Icon} />
			<span className="min-w-0 break-words">{message}</span>
		</div>
	);
}

const URL_SCHEME_RE = /^https?:\/\//;

/** A post link. External and untrusted, so `noopener noreferrer` is mandatory. */
function PostLink({ url }: { url: string }) {
	return (
		<a
			className="inline-flex items-center gap-1 text-primary hover:underline"
			href={url}
			rel="noopener noreferrer"
			target="_blank"
			title={url}
		>
			<HugeiconsIcon className="size-3" icon={LinkSquare01Icon} />
			<span className="max-w-40 truncate">
				{url.replace(URL_SCHEME_RE, "")}
			</span>
		</a>
	);
}

const HTTPS_URL_RE = /^https:\/\//;

/** Composio's "connect this account" link, offered only when it is an `https:`
 *  URL.
 *
 *  The value comes out of an upstream response and lands in an `href`, so a
 *  scheme this panel cannot vouch for (`javascript:`, `data:`) must never become
 *  clickable. Refusing the link and leaving the sidecar's message on its own is
 *  the honest fallback — the operator can still connect the account from
 *  Composio, and a link that is not offered cannot run anything. */
function ConnectLink({ url }: { url: string | null | undefined }) {
	if (!(url && HTTPS_URL_RE.test(url))) {
		return null;
	}
	return (
		<a
			className="inline-flex items-center gap-1 text-primary hover:underline"
			href={url}
			rel="noopener noreferrer"
			target="_blank"
			title={url}
		>
			<HugeiconsIcon className="size-3" icon={LinkSquare01Icon} />
			Connect account
		</a>
	);
}

// ── Panel root ───────────────────────────────────────────────────────────────

/** The dock panel. Feature-detected against the app registry exactly as the
 *  Simulator panel is: with the app off there is no sidecar to talk to, so the
 *  panel says so instead of showing an unreachable-host error. */
export function UgcPanel() {
	const { apps } = useApps();
	const enabled = apps.some((a) => a.id === UGC_PLUGIN_ID && a.enabled);
	if (!enabled) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground text-xs">
				<HugeiconsIcon className="size-6 opacity-60" icon={Megaphone01Icon} />
				<p className="max-w-xs">
					Enable the <span className="font-medium">UGC</span> app to track
					creator campaigns, submissions and payouts from here.
				</p>
			</div>
		);
	}
	return <UgcWorkspace />;
}

type UgcView = "campaigns" | "payouts";

function UgcWorkspace() {
	const call = useUgcCall();
	const [view, setView] = useState<UgcView>("campaigns");
	const [revision, setRevision] = useState(0);
	const [addingCreator, setAddingCreator] = useState(false);
	const [creators, setCreators] = useState<Creator[]>([]);
	const [platforms, setPlatforms] = useState<PlatformSource[]>([]);
	/** The Composio credential's state, or null while it is unknown. `/settings`
	 *  is the single read for it: `/platforms` reports the same `composio_configured`
	 *  boolean, but only `/settings` also says which source backs it, and one fact
	 *  read twice is a fact that can disagree with itself the moment the settings
	 *  dialog stores a key. */
	const [composio, setComposio] = useState<UgcSettings | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [overview, setOverview] = useState<UgcOverview | null>(null);

	/** Anything that changes server state bumps this; every view re-reads. */
	const invalidate = useCallback(() => setRevision((r) => r + 1), []);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			// The bare mount is the sidecar's cross-campaign rollup — the one read
			// that answers "what is the state of everything" without a campaign.
			const [overviewData, creatorData, platformData, settingsData] =
				await Promise.all([
					call<UgcOverview>(""),
					call<unknown>("/creators"),
					call<unknown>("/platforms"),
					// Caught on its own: a sidecar without the settings route must cost
					// the panel the key's state, not the whole first paint.
					call<unknown>("/settings").catch(() => null),
				]);
			if (cancelled) {
				return;
			}
			setOverview(overviewData);
			setCreators(listOf<Creator>(creatorData, "creators"));
			setPlatforms(listOf<PlatformSource>(platformData, "platforms"));
			setComposio(readSettings(settingsData));
		};
		load().catch(() => {
			// The views below each surface their own fetch error; a failure here only
			// costs the rollup, display names and platform labels, so it must not
			// blank the panel.
			if (!cancelled) {
				setOverview(null);
				setCreators([]);
				setPlatforms([]);
				// Back to "unknown" rather than to a stale answer: this build cannot
				// tell whether the key state changed or the sidecar simply went away.
				setComposio(null);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [call, revision]);

	const creatorName = useCallback(
		(id: string) =>
			creators.find((c) => c.id === id)?.display_name ?? id.slice(0, 8),
		[creators]
	);

	const platformLabel = useCallback(
		(platform: string) =>
			platforms.find((p) => p.platform === platform)?.label ?? platform,
		[platforms]
	);

	return (
		<Tabs
			className="flex h-full min-h-0 flex-col"
			onValueChange={(v) => setView(v as UgcView)}
			value={view}
		>
			<header className="flex shrink-0 items-center gap-2 border-border/60 border-b bg-sidebar px-2 py-1.5">
				<HugeiconsIcon
					className="size-3.5 shrink-0 text-muted-foreground"
					icon={Megaphone01Icon}
				/>
				<TabsList variant="pills">
					<TabsTrigger value="campaigns">Campaigns</TabsTrigger>
					<TabsTrigger value="payouts">Payouts</TabsTrigger>
				</TabsList>
				<span className="flex-1" />
				{overview ? (
					<span className="hidden truncate text-[11px] text-muted-foreground tabular-nums sm:inline">
						{overview.campaigns} campaigns · {overview.creators} creators ·{" "}
						{overview.submissions.pending} pending ·{" "}
						<span className="font-heading">
							{formatCents(overview.accrued_cents)}
						</span>{" "}
						accrued ·{" "}
						<span className="font-heading">
							{formatCents(overview.paid_cents)}
						</span>{" "}
						paid
					</span>
				) : null}
				{/* The roster is the entry point of the whole flow — a submission binds a
				    creator to a campaign, so with an empty roster nothing can be
				    recorded and nothing ever accrues. It lives in the workspace header
				    rather than inside the submission dialog because the roster spans
				    campaigns and both tabs render creator names from it. */}
				<Button
					onClick={() => setAddingCreator(true)}
					size="xs"
					title="Add a creator to the roster"
					type="button"
					variant="ghost"
				>
					<HugeiconsIcon icon={UserGroupIcon} />
					Add creator
				</Button>
				<Button
					onClick={invalidate}
					size="xs"
					title="Reload from the sidecar"
					type="button"
					variant="ghost"
				>
					<HugeiconsIcon icon={RefreshIcon} />
					Reload
				</Button>
				{/* The Composio credential automated reads use. It lives in the header
				    because it is node-wide, not per campaign. */}
				<Button
					onClick={() => setSettingsOpen(true)}
					size="icon-sm"
					title="Composio API key"
					type="button"
					variant="ghost"
				>
					<HugeiconsIcon icon={Settings01Icon} />
					<span className="sr-only">Composio API key</span>
				</Button>
			</header>
			<NewCreatorDialog
				onCreated={invalidate}
				onOpenChange={setAddingCreator}
				open={addingCreator}
			/>
			<ComposioSettingsDialog
				onOpenChange={setSettingsOpen}
				onSettings={setComposio}
				open={settingsOpen}
				settings={composio}
			/>
			<TabsContent className="flex min-h-0 flex-1 flex-col" value="campaigns">
				<CampaignsView
					composio={composio}
					creatorName={creatorName}
					creators={creators}
					invalidate={invalidate}
					onOpenSettings={() => setSettingsOpen(true)}
					platformLabel={platformLabel}
					platforms={platforms}
					revision={revision}
				/>
			</TabsContent>
			<TabsContent className="flex min-h-0 flex-1 flex-col" value="payouts">
				<PayoutsView
					creatorName={creatorName}
					invalidate={invalidate}
					revision={revision}
				/>
			</TabsContent>
		</Tabs>
	);
}

// ── Campaigns ────────────────────────────────────────────────────────────────

const CAMPAIGN_STATUS_FILTERS: Array<{ label: string; value: string }> = [
	{ label: "All statuses", value: "" },
	{ label: "Draft", value: "draft" },
	{ label: "Active", value: "active" },
	{ label: "Paused", value: "paused" },
	{ label: "Ended", value: "ended" },
];

function CampaignsView({
	composio,
	creatorName,
	creators,
	invalidate,
	onOpenSettings,
	platformLabel,
	platforms,
	revision,
}: {
	composio: UgcSettings | null;
	creatorName: (id: string) => string;
	creators: Creator[];
	invalidate: () => void;
	onOpenSettings: () => void;
	platformLabel: (platform: string) => string;
	platforms: PlatformSource[];
	revision: number;
}) {
	const call = useUgcCall();
	const [campaigns, setCampaigns] = useState<Campaign[]>([]);
	const [statusFilter, setStatusFilter] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		const query = statusFilter ? `?status=${statusFilter}` : "";
		call<unknown>(`/campaigns${query}`)
			.then((data) => {
				if (cancelled) {
					return;
				}
				const rows = listOf<Campaign>(data, "campaigns");
				setCampaigns(rows);
				setError(null);
				setSelectedId((prev) =>
					prev && rows.some((c) => c.id === prev) ? prev : (rows[0]?.id ?? null)
				);
			})
			.catch((err: unknown) => {
				if (!cancelled) {
					setCampaigns([]);
					setError(describeError(err));
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [call, statusFilter, revision]);

	const selected = campaigns.find((c) => c.id === selectedId) ?? null;

	return (
		<div className="flex min-h-0 flex-1">
			<aside className="flex w-64 shrink-0 flex-col border-border/60 border-r">
				<div className="flex shrink-0 items-center gap-1.5 border-border/60 border-b px-2 py-1.5">
					<NativeSelect
						aria-label="Filter campaigns by status"
						className="w-full"
						onChange={(e) => setStatusFilter(e.target.value)}
						size="sm"
						value={statusFilter}
					>
						{CAMPAIGN_STATUS_FILTERS.map((opt) => (
							<NativeSelectOption key={opt.value} value={opt.value}>
								{opt.label}
							</NativeSelectOption>
						))}
					</NativeSelect>
					<Button
						onClick={() => setCreating(true)}
						size="icon-sm"
						title="New campaign"
						type="button"
						variant="ghost"
					>
						<HugeiconsIcon icon={PlusSignIcon} />
						<span className="sr-only">New campaign</span>
					</Button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">
					{loading && campaigns.length === 0 ? <LoadingRow /> : null}
					{error ? (
						<div className="p-2">
							<ErrorBanner message={error} />
						</div>
					) : null}
					{!(loading || error) && campaigns.length === 0 ? (
						<PanelNotice>
							No campaigns yet. Create one to start tracking submissions.
						</PanelNotice>
					) : null}
					<ul>
						{campaigns.map((campaign) => (
							<li key={campaign.id}>
								<button
									className={cn(
										"w-full border-border/40 border-b px-2.5 py-2 text-left",
										campaign.id === selectedId
											? "bg-accent"
											: "hover:bg-muted/50"
									)}
									onClick={() => setSelectedId(campaign.id)}
									type="button"
								>
									<span className="flex items-center gap-1.5">
										<span className="min-w-0 flex-1 truncate font-medium text-xs">
											{campaign.brand || "Untitled campaign"}
										</span>
										<StatusPill
											label={campaign.status}
											variant={
												CAMPAIGN_STATUS_VARIANT[campaign.status] ?? "outline"
											}
										/>
									</span>
									<span className="mt-1 block text-[11px] text-muted-foreground">
										{campaign.budget_cents > 0 ? (
											<>
												Budget{" "}
												<span className="font-heading tabular-nums">
													{formatCents(campaign.budget_cents)}
												</span>
											</>
										) : (
											"No budget cap"
										)}
									</span>
								</button>
							</li>
						))}
					</ul>
				</div>
			</aside>
			<div className="min-w-0 flex-1 overflow-y-auto">
				{selected ? (
					<CampaignDetail
						campaign={selected}
						composio={composio}
						creatorName={creatorName}
						creators={creators}
						invalidate={invalidate}
						onOpenSettings={onOpenSettings}
						platformLabel={platformLabel}
						platforms={platforms}
						revision={revision}
					/>
				) : (
					<div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground text-xs">
						Select a campaign to see its submissions, leaderboard and spend.
					</div>
				)}
			</div>
			<NewCampaignDialog
				onCreated={invalidate}
				onOpenChange={setCreating}
				open={creating}
				platforms={platforms}
			/>
		</div>
	);
}

const SUBMISSION_STATUS_FILTERS: Array<{ label: string; value: string }> = [
	{ label: "All submissions", value: "" },
	{ label: "Pending", value: "pending" },
	{ label: "Approved", value: "approved" },
	{ label: "Rejected", value: "rejected" },
	{ label: "Paid", value: "paid" },
];

interface CampaignDetailData {
	leaderboard: LeaderboardRow[];
	submissions: Submission[];
	summary: CampaignSummary | null;
}

function CampaignDetail({
	campaign,
	composio,
	creatorName,
	creators,
	invalidate,
	onOpenSettings,
	platformLabel,
	platforms,
	revision,
}: {
	campaign: Campaign;
	composio: UgcSettings | null;
	creatorName: (id: string) => string;
	creators: Creator[];
	invalidate: () => void;
	onOpenSettings: () => void;
	platformLabel: (platform: string) => string;
	platforms: PlatformSource[];
	revision: number;
}) {
	const call = useUgcCall();
	const [data, setData] = useState<CampaignDetailData>({
		leaderboard: [],
		submissions: [],
		summary: null,
	});
	const [statusFilter, setStatusFilter] = useState("");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	// Tagged with the campaign it was run against, so switching campaigns cannot
	// leave another campaign's refresh report on screen. One state for both the
	// campaign-wide run and a single row's, because a single row can answer
	// `needs_connection` too and that answer must not vanish into a reload.
	const [refreshReport, setRefreshReport] = useState<{
		campaignId: string;
		counts: RefreshCounts;
		results: SubmissionRefreshReport[];
	} | null>(null);
	const [adding, setAdding] = useState(false);
	const [rejecting, setRejecting] = useState<Submission | null>(null);
	/** The submission whose counters are being entered by hand, or null. Holding
	 *  the row (not just its id) is what lets the dialog prefill from the latest
	 *  snapshot. */
	const [recordingMetrics, setRecordingMetrics] = useState<Submission | null>(
		null
	);
	const [actionError, setActionError] = useState<string | null>(null);

	const campaignId = campaign.id;

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		const query = statusFilter ? `?status=${statusFilter}` : "";
		Promise.all([
			call<CampaignSummary>(
				`/campaigns/${encodeURIComponent(campaignId)}/summary`
			),
			call<unknown>(
				`/campaigns/${encodeURIComponent(campaignId)}/submissions${query}`
			),
			call<unknown>(
				`/campaigns/${encodeURIComponent(campaignId)}/leaderboard?limit=${LEADERBOARD_LIMIT}`
			),
		])
			.then(([summary, submissions, leaderboard]) => {
				if (cancelled) {
					return;
				}
				setData({
					leaderboard: listOf<LeaderboardRow>(leaderboard, "leaderboard"),
					submissions: listOf<Submission>(submissions, "submissions"),
					summary,
				});
				setError(null);
			})
			.catch((err: unknown) => {
				if (!cancelled) {
					setError(describeError(err));
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [call, campaignId, statusFilter, revision]);

	const review = useCallback(
		async (
			submission: Submission,
			decision: "approve" | "reject",
			reason?: string
		) => {
			setActionError(null);
			try {
				await call(`/submissions/${encodeURIComponent(submission.id)}/review`, {
					body: JSON.stringify({ decision, reason }),
					method: "POST",
				});
				invalidate();
			} catch (err) {
				setActionError(describeError(err));
			}
		},
		[call, invalidate]
	);

	const refreshMetrics = useCallback(async () => {
		setRefreshing(true);
		setActionError(null);
		// Cleared before the run, not after it: a report left on screen while a new
		// run is in flight — or beside the error of a run that never produced one —
		// would describe results this click did not get.
		setRefreshReport(null);
		try {
			const resp = await call<{ counts?: unknown }>(
				`/campaigns/${encodeURIComponent(campaignId)}/refresh`,
				{
					method: "POST",
				}
			);
			// A 200 here does NOT mean every submission was read: the route is
			// best-effort per submission and reports each one's outcome as one of
			// three, so the report is rendered rather than counted as a success.
			const results = listOf<SubmissionRefreshReport>(resp, "results").map(
				readRefreshRow
			);
			setRefreshReport({
				campaignId,
				counts: isRefreshCounts(resp.counts)
					? resp.counts
					: tallyRefresh(results),
				results,
			});
			invalidate();
		} catch (err) {
			setActionError(describeError(err));
		} finally {
			setRefreshing(false);
		}
	}, [call, campaignId, invalidate]);

	/** The escape hatch for one post: re-read just this submission's counters.
	 *  A platform with no curated source 400s here with that exact explanation. */
	const refreshOne = useCallback(
		async (submission: Submission) => {
			setActionError(null);
			// Same reason as the campaign-wide run: the last report must not survive
			// a click that failed to produce one.
			setRefreshReport(null);
			try {
				const resp = await call<SubmissionRefreshReport>(
					`/submissions/${encodeURIComponent(submission.id)}/refresh`,
					{
						method: "POST",
					}
				);
				// A 200 on this route is not necessarily a reading either: an unlinked
				// account comes back `needs_connection` having written nothing, so it
				// goes through the same report as a campaign-wide run instead of
				// looking like a refresh that worked.
				const row = readRefreshRow(resp);
				setRefreshReport({
					campaignId,
					counts: tallyRefresh([row]),
					results: [row],
				});
				invalidate();
			} catch (err) {
				setActionError(describeError(err));
			}
		},
		[call, campaignId, invalidate]
	);

	const hasMetricSource = useCallback(
		(platform: string) => platforms.some((p) => p.platform === platform),
		[platforms]
	);

	/** Name a reported row in the operator's terms. The id itself when the row is
	 *  not on screen — a campaign refresh covers every approved submission, not
	 *  only the ones the current status filter shows. */
	const describeRow = useCallback(
		(submissionId: string) => {
			const row = data.submissions.find((s) => s.id === submissionId);
			return row
				? `${creatorName(row.creator_id)} · ${platformLabel(row.platform)}`
				: submissionId.slice(0, 8);
		},
		[creatorName, data.submissions, platformLabel]
	);

	const summary = data.summary;
	const report =
		refreshReport?.campaignId === campaignId ? refreshReport : null;
	const composioMissing = composio?.composio_configured === false;

	return (
		<section className="flex flex-col gap-3 p-3">
			<header className="flex flex-wrap items-center gap-2">
				<h2 className="min-w-0 font-heading font-medium text-sm">
					{campaign.brand || "Untitled campaign"}
				</h2>
				<StatusPill
					label={campaign.status}
					variant={CAMPAIGN_STATUS_VARIANT[campaign.status] ?? "outline"}
				/>
				<span className="text-[11px] text-muted-foreground">
					{formatDate(campaign.starts_at)} → {formatDate(campaign.ends_at)}
				</span>
				<span className="text-[11px] text-muted-foreground">
					· {formatPayoutRule(campaign.payout)}
				</span>
				<span className="flex-1" />
				<Button
					disabled={refreshing}
					onClick={() => {
						refreshMetrics().catch(() => undefined);
					}}
					size="xs"
					title={
						composioMissing
							? "No Composio API key is configured — add one in the panel's settings, or record metrics by hand"
							: "Refresh metrics for every approved submission"
					}
					type="button"
					variant="outline"
				>
					{refreshing ? (
						<Spinner className="size-3" />
					) : (
						<HugeiconsIcon icon={RefreshIcon} />
					)}
					Refresh metrics
				</Button>
				<Button
					onClick={() => setAdding(true)}
					size="xs"
					type="button"
					variant="secondary"
				>
					<HugeiconsIcon icon={PlusSignIcon} />
					Add submission
				</Button>
			</header>

			{campaign.brief ? (
				<p className="text-muted-foreground text-xs">{campaign.brief}</p>
			) : null}

			{error ? <ErrorBanner message={error} /> : null}
			{actionError ? <ErrorBanner message={actionError} /> : null}
			{report ? (
				<RefreshReport
					counts={report.counts}
					describeRow={describeRow}
					results={report.results}
				/>
			) : null}

			{loading && !summary ? <LoadingRow /> : null}
			{summary ? (
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
					<StatTile
						hint={
							campaign.budget_cents > 0
								? `of ${formatCents(summary.budget_cents)}`
								: "no budget cap"
						}
						label="Accrued"
						value={formatCents(summary.accrued_cents)}
					/>
					<StatTile
						hint={`${formatCents(summary.approved_cents)} approved`}
						label="Paid"
						value={formatCents(summary.paid_cents)}
					/>
					<StatTile
						hint={`${formatCount(summary.total_likes)} likes`}
						label="Views"
						value={formatCount(summary.total_views)}
					/>
					<StatTile
						hint={`${summary.creators} creators`}
						label="Submissions"
						value={`${summary.submissions.pending} pending · ${summary.submissions.approved} approved`}
					/>
				</div>
			) : null}
			{summary ? (
				<SpendBar
					budgetCents={summary.budget_cents}
					spentCents={summary.accrued_cents}
				/>
			) : null}

			<div className="flex items-center gap-2">
				<h3 className="font-medium text-xs">Submissions</h3>
				<NativeSelect
					aria-label="Filter submissions by status"
					onChange={(e) => setStatusFilter(e.target.value)}
					size="sm"
					value={statusFilter}
				>
					{SUBMISSION_STATUS_FILTERS.map((opt) => (
						<NativeSelectOption key={opt.value} value={opt.value}>
							{opt.label}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</div>
			{/* Keyed on the one narrow question the sidecar can actually answer: does
			    a Composio API key resolve in its process at all. So the copy claims
			    only that, and names the fix. It does NOT promise the reads would
			    otherwise succeed — whether each platform's account is linked is a
			    separate fact, reported per submission as "needs a connection". */}
			{composioMissing ? (
				<div className="flex flex-wrap items-center gap-2 px-3 py-2 text-muted-foreground text-xs">
					<span className="min-w-0">
						No Composio API key is configured, so automated refreshes have
						nothing to read with. Record metrics by hand meanwhile.
					</span>
					<Button
						onClick={onOpenSettings}
						size="xs"
						type="button"
						variant="outline"
					>
						<HugeiconsIcon icon={Settings01Icon} />
						Add a key
					</Button>
				</div>
			) : null}
			<SubmissionsTable
				creatorName={creatorName}
				hasMetricSource={hasMetricSource}
				onApprove={(s) => {
					review(s, "approve").catch(() => undefined);
				}}
				onRecordMetrics={setRecordingMetrics}
				onRefresh={(s) => {
					refreshOne(s).catch(() => undefined);
				}}
				onReject={setRejecting}
				platformLabel={platformLabel}
				submissions={data.submissions}
			/>

			<h3 className="font-medium text-xs">Creator leaderboard</h3>
			<LeaderboardTable creatorName={creatorName} rows={data.leaderboard} />

			<NewSubmissionDialog
				campaign={campaign}
				creators={creators}
				onCreated={invalidate}
				onOpenChange={setAdding}
				open={adding}
				platforms={platforms}
			/>
			{/* Mounted only while a row is selected and keyed by that row's id, so
			    the five prefilled counters can never be a previously-opened
			    submission's — a stale number here would be written back as this
			    post's truth. */}
			{recordingMetrics ? (
				<RecordMetricsDialog
					key={recordingMetrics.id}
					onClose={() => setRecordingMetrics(null)}
					onRecorded={() => {
						setRecordingMetrics(null);
						invalidate();
					}}
					submission={recordingMetrics}
				/>
			) : null}
			<RejectSubmissionDialog
				onConfirm={(reason) => {
					const target = rejecting;
					setRejecting(null);
					if (target) {
						review(target, "reject", reason).catch(() => undefined);
					}
				}}
				onOpenChange={(next) => {
					if (!next) {
						setRejecting(null);
					}
				}}
				submission={rejecting}
			/>
		</section>
	);
}

/** What one refresh run did, split three ways.
 *
 *  `needs_connection` gets its own affordance rather than the destructive
 *  `ErrorBanner`: nothing is broken — the account behind that platform is simply
 *  not linked to this node's Composio entity yet — and the row carries Composio's
 *  own connect link when it offered one. Those rows wrote no snapshot and
 *  re-priced no payout, which is why the summary line counts them apart from the
 *  refreshed ones instead of reporting a flat total. */
function RefreshReport({
	counts,
	describeRow,
	results,
}: {
	counts: RefreshCounts;
	describeRow: (submissionId: string) => string;
	results: SubmissionRefreshReport[];
}) {
	const needsConnection = results.filter(
		(r) => r.status === "needs_connection"
	);
	const failed = results.filter((r) => r.status === "error");
	return (
		<div className="flex flex-col gap-2">
			<PanelNotice>{describeRefreshCounts(counts)}.</PanelNotice>
			{needsConnection.length > 0 ? (
				<div className="flex flex-col gap-1.5 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-xs">
					<span className="flex items-center gap-1.5 font-medium">
						<HugeiconsIcon className="size-3.5" icon={PlugSocketIcon} />
						Connect these accounts to read their counters
					</span>
					{needsConnection.map((row) => (
						<span
							className="flex flex-wrap items-center gap-1.5"
							key={row.submission_id}
						>
							<span>{describeRow(row.submission_id)}</span>
							<span className="min-w-0 break-words text-muted-foreground">
								{row.message ??
									"This platform's account is not linked to Composio yet."}
							</span>
							<ConnectLink url={row.connect_url} />
						</span>
					))}
				</div>
			) : null}
			{failed.length > 0 ? (
				<ErrorBanner
					message={`Could not refresh ${failed.length} submission${
						failed.length === 1 ? "" : "s"
					}: ${failed
						.map(
							(row) =>
								`${describeRow(row.submission_id)} — ${
									row.message ?? "no reason given"
								}`
						)
						.join("; ")}`}
				/>
			) : null}
		</div>
	);
}

/** One post's accrued money and the state that money is in.
 *
 *  The null test is `typeof === "number"` rather than a truthiness or nullish
 *  check on purpose: a payout of exactly $0.00 is a real, reportable outcome (a
 *  campaign priced at zero, or an approved post with no views yet), and it must
 *  not be hidden behind the same "—" that means "nothing has accrued". */
function AccruedCell({
	cents,
	status,
}: {
	cents: number | null | undefined;
	status: PayoutStatus | null | undefined;
}) {
	if (typeof cents !== "number") {
		return <span className="text-muted-foreground">—</span>;
	}
	return (
		<span className="flex items-center justify-end gap-1.5">
			<span className="font-heading tabular-nums">{formatCents(cents)}</span>
			{status ? (
				<StatusPill
					label={status}
					variant={PAYOUT_STATUS_VARIANT[status] ?? "outline"}
				/>
			) : null}
		</span>
	);
}

function SubmissionsTable({
	creatorName,
	hasMetricSource,
	onApprove,
	onRecordMetrics,
	onRefresh,
	onReject,
	platformLabel,
	submissions,
}: {
	creatorName: (id: string) => string;
	/** Whether the sidecar curates a Composio source for this platform. Without
	 *  one there is nothing to refresh, so the row does not offer it. */
	hasMetricSource: (platform: string) => boolean;
	onApprove: (submission: Submission) => void;
	onRecordMetrics: (submission: Submission) => void;
	onRefresh: (submission: Submission) => void;
	onReject: (submission: Submission) => void;
	platformLabel: (platform: string) => string;
	submissions: Submission[];
}) {
	if (submissions.length === 0) {
		return (
			<PanelNotice>
				No submissions match this filter. Creators&apos; posts appear here once
				recorded.
			</PanelNotice>
		);
	}
	return (
		<Table className="text-xs">
			<TableHeader>
				<TableRow>
					<TableHead className="h-8 px-2 text-xs">Creator</TableHead>
					<TableHead className="h-8 px-2 text-xs">Platform</TableHead>
					<TableHead className="h-8 px-2 text-xs">Post</TableHead>
					<TableHead className="h-8 px-2 text-xs">Status</TableHead>
					<TableHead className="h-8 px-2 text-right text-xs">Views</TableHead>
					<TableHead className="h-8 px-2 text-right text-xs">Accrued</TableHead>
					<TableHead className="h-8 px-2 text-xs">
						<span className="sr-only">Review actions</span>
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{submissions.map((submission) => (
					<TableRow key={submission.id}>
						<TableCell className="p-2">
							{creatorName(submission.creator_id)}
						</TableCell>
						<TableCell className="p-2">
							{platformLabel(submission.platform)}
						</TableCell>
						<TableCell className="p-2">
							<PostLink url={submission.post_url} />
						</TableCell>
						<TableCell className="p-2">
							<StatusPill
								label={submission.status}
								variant={
									SUBMISSION_STATUS_VARIANT[submission.status] ?? "outline"
								}
							/>
						</TableCell>
						<TableCell className="p-2 text-right tabular-nums">
							{submission.latest ? formatCount(submission.latest.views) : "—"}
						</TableCell>
						<TableCell className="p-2 text-right tabular-nums">
							<AccruedCell
								cents={submission.accrued_cents}
								status={submission.payout_status}
							/>
						</TableCell>
						<TableCell className="p-2 text-right">
							<SubmissionRowActions
								hasMetricSource={hasMetricSource}
								onApprove={onApprove}
								onRecordMetrics={onRecordMetrics}
								onRefresh={onRefresh}
								onReject={onReject}
								submission={submission}
							/>
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

/** The per-row actions.
 *
 *  "Record metrics" is offered on every row that is not rejected, and it is NOT
 *  gated on `hasMetricSource` or on Composio being connected: it is the only way
 *  to get counters onto a platform the sidecar curates no source for, and it is
 *  the correction path when an automated read is wrong. A pending post gets it
 *  too — views are usually what the approve/reject decision turns on.
 *
 *  The Composio refresh stays where it was, on reviewed rows with a curated
 *  source, so the row never offers a read that has nothing to read from. */
function SubmissionRowActions({
	hasMetricSource,
	onApprove,
	onRecordMetrics,
	onRefresh,
	onReject,
	submission,
}: {
	hasMetricSource: (platform: string) => boolean;
	onApprove: (submission: Submission) => void;
	onRecordMetrics: (submission: Submission) => void;
	onRefresh: (submission: Submission) => void;
	onReject: (submission: Submission) => void;
	submission: Submission;
}) {
	const recordButton = (
		<Button
			onClick={() => onRecordMetrics(submission)}
			size="icon-xs"
			title="Record this post's metrics by hand"
			type="button"
			variant="ghost"
		>
			<HugeiconsIcon icon={ChartLineData01Icon} />
			<span className="sr-only">Record metrics</span>
		</Button>
	);

	if (submission.status === "pending") {
		return (
			<span className="flex items-center justify-end gap-1">
				<Button
					onClick={() => onApprove(submission)}
					size="xs"
					type="button"
					variant="secondary"
				>
					Approve
				</Button>
				<Button
					onClick={() => onReject(submission)}
					size="xs"
					type="button"
					variant="ghost"
				>
					Reject
				</Button>
				{recordButton}
			</span>
		);
	}

	return (
		<span className="flex items-center justify-end gap-1">
			<span className="max-w-40 truncate text-muted-foreground">
				{submission.rejection_reason ?? ""}
			</span>
			{submission.status === "rejected" ? null : recordButton}
			{submission.status !== "rejected" &&
			hasMetricSource(submission.platform) ? (
				<Button
					onClick={() => onRefresh(submission)}
					size="icon-xs"
					title="Refresh this post's metrics"
					type="button"
					variant="ghost"
				>
					<HugeiconsIcon icon={RefreshIcon} />
					<span className="sr-only">Refresh metrics</span>
				</Button>
			) : null}
		</span>
	);
}

function LeaderboardTable({
	creatorName,
	rows,
}: {
	creatorName: (id: string) => string;
	rows: LeaderboardRow[];
}) {
	if (rows.length === 0) {
		return (
			<PanelNotice>
				No ranked creators yet — the leaderboard fills in once submissions carry
				metrics.
			</PanelNotice>
		);
	}
	return (
		<Table className="text-xs">
			<TableHeader>
				<TableRow>
					<TableHead className="h-8 px-2 text-xs">Creator</TableHead>
					<TableHead className="h-8 px-2 text-right text-xs">Views</TableHead>
					<TableHead className="h-8 px-2 text-right text-xs">
						Approved
					</TableHead>
					<TableHead className="h-8 px-2 text-right text-xs">Accrued</TableHead>
					<TableHead className="h-8 px-2 text-right text-xs">Paid</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((row) => (
					<TableRow key={row.creator_id}>
						{/* `||`, not `??`: the sidecar always sends this key and sends it
						    EMPTY when the creator row was deleted out from under the
						    submissions, so a nullish fallback would never fire and the
						    cell would render blank instead of the roster lookup. */}
						<TableCell className="p-2">
							{row.display_name || creatorName(row.creator_id)}
						</TableCell>
						<TableCell className="p-2 text-right tabular-nums">
							{formatCount(row.views)}
						</TableCell>
						<TableCell className="p-2 text-right tabular-nums">
							{row.approved_submissions}
						</TableCell>
						<TableCell className="p-2 text-right font-heading tabular-nums">
							{formatCents(row.accrued_cents)}
						</TableCell>
						<TableCell className="p-2 text-right font-heading tabular-nums">
							{formatCents(row.paid_cents)}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

// ── Payouts ──────────────────────────────────────────────────────────────────

const PAYOUT_STATUS_FILTERS: Array<{ label: string; value: string }> = [
	{ label: "All payouts", value: "" },
	{ label: "Accrued", value: "accrued" },
	{ label: "Approved", value: "approved" },
	{ label: "Paid", value: "paid" },
];

/** The money-adjacent confirm. `approve` and `paid` are both one-way transitions
 *  the sidecar refuses to undo, so neither fires from a bare click — the repo's
 *  irreversible-action idiom (an `AlertDialog` naming the exact consequence). */
interface PendingPayoutAction {
	payout: Payout;
	step: "approve" | "paid";
}

function PayoutsView({
	creatorName,
	invalidate,
	revision,
}: {
	creatorName: (id: string) => string;
	invalidate: () => void;
	revision: number;
}) {
	const call = useUgcCall();
	const [payouts, setPayouts] = useState<Payout[]>([]);
	const [statusFilter, setStatusFilter] = useState("");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [pending, setPending] = useState<PendingPayoutAction | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		const query = statusFilter ? `?status=${statusFilter}` : "";
		call<unknown>(`/payouts${query}`)
			.then((data) => {
				if (cancelled) {
					return;
				}
				setPayouts(listOf<Payout>(data, "payouts"));
				setError(null);
			})
			.catch((err: unknown) => {
				if (!cancelled) {
					setPayouts([]);
					setError(describeError(err));
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [call, statusFilter, revision]);

	const commit = useCallback(
		async (action: PendingPayoutAction) => {
			setActionError(null);
			try {
				await call(
					`/payouts/${encodeURIComponent(action.payout.id)}/${action.step}`,
					{
						method: "POST",
					}
				);
				invalidate();
			} catch (err) {
				setActionError(describeError(err));
			}
		},
		[call, invalidate]
	);

	return (
		<section className="flex min-h-0 flex-1 flex-col gap-2 p-3">
			<div className="flex items-center gap-2">
				<h2 className="font-heading font-medium text-sm">Payouts</h2>
				<NativeSelect
					aria-label="Filter payouts by status"
					onChange={(e) => setStatusFilter(e.target.value)}
					size="sm"
					value={statusFilter}
				>
					{PAYOUT_STATUS_FILTERS.map((opt) => (
						<NativeSelectOption key={opt.value} value={opt.value}>
							{opt.label}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</div>
			{error ? <ErrorBanner message={error} /> : null}
			{actionError ? <ErrorBanner message={actionError} /> : null}
			{loading && payouts.length === 0 ? <LoadingRow /> : null}
			{!(loading || error) && payouts.length === 0 ? (
				<PanelNotice>
					No payouts yet. Approving a submission accrues one automatically.
				</PanelNotice>
			) : null}
			{payouts.length > 0 ? (
				<div className="min-h-0 flex-1 overflow-y-auto">
					<PayoutsTable
						creatorName={creatorName}
						onAct={setPending}
						payouts={payouts}
					/>
				</div>
			) : null}
			<ConfirmPayoutDialog
				action={pending}
				creatorName={creatorName}
				onConfirm={() => {
					const action = pending;
					setPending(null);
					if (action) {
						commit(action).catch(() => undefined);
					}
				}}
				onOpenChange={(next) => {
					if (!next) {
						setPending(null);
					}
				}}
			/>
		</section>
	);
}

function PayoutsTable({
	creatorName,
	onAct,
	payouts,
}: {
	creatorName: (id: string) => string;
	onAct: (action: PendingPayoutAction) => void;
	payouts: Payout[];
}) {
	return (
		<Table className="text-xs">
			<TableHeader>
				<TableRow>
					<TableHead className="h-8 px-2 text-xs">Creator</TableHead>
					<TableHead className="h-8 px-2 text-xs">Reason</TableHead>
					<TableHead className="h-8 px-2 text-xs">Status</TableHead>
					<TableHead className="h-8 px-2 text-right text-xs">Amount</TableHead>
					<TableHead className="h-8 px-2 text-xs">
						<span className="sr-only">Payout actions</span>
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{payouts.map((payout) => (
					<TableRow key={payout.id}>
						<TableCell className="p-2">
							{creatorName(payout.creator_id)}
						</TableCell>
						<TableCell className="max-w-56 truncate p-2 text-muted-foreground">
							{payout.reason || "—"}
						</TableCell>
						<TableCell className="p-2">
							<StatusPill
								label={payout.status}
								variant={PAYOUT_STATUS_VARIANT[payout.status] ?? "outline"}
							/>
						</TableCell>
						<TableCell className="p-2 text-right font-heading tabular-nums">
							{formatCents(payout.amount_cents)}
						</TableCell>
						<TableCell className="p-2 text-right">
							<PayoutRowAction onAct={onAct} payout={payout} />
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

function PayoutRowAction({
	onAct,
	payout,
}: {
	onAct: (action: PendingPayoutAction) => void;
	payout: Payout;
}) {
	if (payout.status === "accrued") {
		return (
			<Button
				onClick={() => onAct({ payout, step: "approve" })}
				size="xs"
				type="button"
				variant="secondary"
			>
				<HugeiconsIcon icon={Coins01Icon} />
				Approve
			</Button>
		);
	}
	if (payout.status === "approved") {
		return (
			<Button
				onClick={() => onAct({ payout, step: "paid" })}
				size="xs"
				type="button"
				variant="outline"
			>
				Mark paid
			</Button>
		);
	}
	return <span className="text-muted-foreground">Settled</span>;
}

function ConfirmPayoutDialog({
	action,
	creatorName,
	onConfirm,
	onOpenChange,
}: {
	action: PendingPayoutAction | null;
	creatorName: (id: string) => string;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
}) {
	const approving = action?.step === "approve";
	return (
		<AlertDialog onOpenChange={onOpenChange} open={action !== null}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{approving ? "Approve this payout?" : "Mark this payout as paid?"}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{action ? (
							<>
								<span className="font-heading tabular-nums">
									{formatCents(action.payout.amount_cents)}
								</span>{" "}
								to {creatorName(action.payout.creator_id)}.{" "}
								{approving
									? "Approving clears it for payment; it can no longer be re-priced as views grow."
									: "Marking it paid also flips its submission to paid. This cannot be undone."}
							</>
						) : null}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm}>
						{approving ? "Approve payout" : "Mark paid"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

// ── Dialogs ──────────────────────────────────────────────────────────────────

/** The honest state of the key, and nothing more.
 *
 *  An environment-provided key is reported as exactly that and NOT offered a
 *  clear button: this panel cannot unset a variable in the sidecar's process, so
 *  a button here could only fail. */
function ComposioKeyState({ settings }: { settings: UgcSettings | null }) {
	if (!settings) {
		return (
			<p className="text-[11px] text-muted-foreground">
				This sidecar did not report whether a key is configured.
			</p>
		);
	}
	if (settings.composio_key_source === "app") {
		return (
			<p className="text-[11px] text-muted-foreground">
				A key saved here is in use. Saving another replaces it.
			</p>
		);
	}
	if (settings.composio_key_source === "env") {
		return (
			<p className="text-[11px] text-muted-foreground">
				This node&apos;s environment supplies the key, so it cannot be cleared
				from here — unset it where it is set. A key saved here takes precedence
				over it.
			</p>
		);
	}
	return (
		<p className="text-[11px] text-muted-foreground">
			No key is configured, so automated refreshes have nothing to read with.
		</p>
	);
}

/** The app's own Composio credential.
 *
 *  This app talks to Composio directly — Core injects no Composio key into a
 *  manifest sidecar — so the key is the app's to hold, and this dialog is the
 *  whole surface over it.
 *
 *  The key is WRITE-ONLY. `GET /settings` answers only whether one resolves and
 *  which source backs it, never the value, a prefix of it or its length, so
 *  there is nothing to prefill: the box starts empty every time and the typed
 *  value is dropped from state the moment the PUT returns. It goes in a request
 *  BODY, never a URL, and it is never logged. */
function ComposioSettingsDialog({
	onOpenChange,
	onSettings,
	open,
	settings,
}: {
	onOpenChange: (open: boolean) => void;
	onSettings: (settings: UgcSettings | null) => void;
	open: boolean;
	settings: UgcSettings | null;
}) {
	const call = useUgcCall();
	const [apiKey, setApiKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Re-read on open: the environment behind an `env` key, or another window,
	// may have changed what resolves since the panel first painted.
	useEffect(() => {
		if (!open) {
			return;
		}
		let cancelled = false;
		call<unknown>("/settings")
			.then((data) => {
				if (!cancelled) {
					onSettings(readSettings(data));
				}
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [call, onSettings, open]);

	const close = useCallback(() => {
		setApiKey("");
		setError(null);
		onOpenChange(false);
	}, [onOpenChange]);

	const save = useCallback(async () => {
		setError(null);
		setBusy(true);
		try {
			const data = await call<unknown>("/settings/composio-key", {
				body: JSON.stringify({ api_key: apiKey }),
				method: "PUT",
			});
			// Held no longer than the request needs it: what is not in state cannot
			// be re-rendered, and the route will never hand it back.
			setApiKey("");
			onSettings(readSettings(data));
			onOpenChange(false);
		} catch (err) {
			setError(describeError(err));
		} finally {
			setBusy(false);
		}
	}, [apiKey, call, onOpenChange, onSettings]);

	const clear = useCallback(async () => {
		setError(null);
		setBusy(true);
		try {
			const data = await call<unknown>("/settings/composio-key", {
				method: "DELETE",
			});
			// The source AFTER the delete, which is `env` when this node's
			// environment still supplies one — reporting that honestly is the point
			// of re-reading the response rather than assuming "none".
			onSettings(readSettings(data));
		} catch (err) {
			setError(describeError(err));
		} finally {
			setBusy(false);
		}
	}, [call, onSettings]);

	return (
		<Dialog
			onOpenChange={(next) => {
				if (next) {
					onOpenChange(true);
					return;
				}
				close();
			}}
			open={open}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Composio API key</DialogTitle>
					<DialogDescription>
						Automated metric refreshes read each post&apos;s counters through
						Composio with this key. It is stored by this app and never read
						back, so the box below is always empty.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					<ComposioKeyState settings={settings} />
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="ugc-composio-key">API key</Label>
						<Input
							autoComplete="off"
							id="ugc-composio-key"
							onChange={(e) => setApiKey(e.target.value)}
							placeholder="Paste a Composio API key"
							spellCheck={false}
							type="password"
							value={apiKey}
						/>
					</div>
					{error ? <ErrorBanner message={error} /> : null}
				</div>
				<DialogFooter>
					{settings?.composio_key_source === "app" ? (
						<Button
							disabled={busy}
							onClick={() => {
								clear().catch(() => undefined);
							}}
							type="button"
							variant="ghost"
						>
							Clear stored key
						</Button>
					) : null}
					<Button onClick={close} type="button" variant="ghost">
						Cancel
					</Button>
					<Button
						disabled={busy || apiKey.trim().length === 0}
						onClick={() => {
							save().catch(() => undefined);
						}}
						type="button"
					>
						{busy ? <Spinner className="size-3.5" /> : null}
						Save key
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

interface PayoutRuleDraft {
	amount: string;
	kind: "cpm_cents" | "flat_cents";
}

function NewCampaignDialog({
	onCreated,
	onOpenChange,
	open,
	platforms,
}: {
	onCreated: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	platforms: PlatformSource[];
}) {
	const call = useUgcCall();
	const [brand, setBrand] = useState("");
	const [brief, setBrief] = useState("");
	const [budget, setBudget] = useState("");
	const [maxPerCreator, setMaxPerCreator] = useState("");
	const [rule, setRule] = useState<PayoutRuleDraft>({
		amount: "",
		kind: "cpm_cents",
	});
	const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const togglePlatform = useCallback((platform: string) => {
		setSelectedPlatforms((prev) =>
			prev.includes(platform)
				? prev.filter((p) => p !== platform)
				: [...prev, platform]
		);
	}, []);

	const submit = useCallback(async () => {
		setError(null);
		const budgetCents = budget.trim() ? dollarsToCents(budget) : 0;
		const ruleCents = dollarsToCents(rule.amount);
		const capCents = maxPerCreator.trim() ? dollarsToCents(maxPerCreator) : 0;
		if (budgetCents === null || capCents === null) {
			setError(
				"Budget and per-creator cap must be amounts like 250 or 250.00."
			);
			return;
		}
		if (ruleCents === null) {
			setError(
				rule.kind === "cpm_cents"
					? "Enter the payout per 1,000 views, e.g. 2.50."
					: "Enter the flat payout per approved post, e.g. 50."
			);
			return;
		}
		setSaving(true);
		try {
			await call("/campaigns", {
				body: JSON.stringify({
					brand: brand.trim(),
					brief: brief.trim(),
					budget_cents: budgetCents,
					max_payout_per_creator_cents: capCents,
					// EXACT wire shape of the sidecar's `CampaignBody.payout`: the field
					// is `payout` (not `payout_rule`), and `PayoutRule` is externally
					// tagged, so the `type` discriminant is mandatory. `CampaignBody`
					// does not deny unknown fields and `payout` carries `#[serde(default)]`
					// — a mis-named or untagged rule is therefore accepted and silently
					// becomes `flat 0c`, i.e. a campaign that accrues nothing forever.
					payout:
						rule.kind === "cpm_cents"
							? { cpm_cents: ruleCents, type: "cpm" }
							: { flat_cents: ruleCents, type: "flat" },
					platforms: selectedPlatforms,
					status: "draft",
				}),
				method: "POST",
			});
			onCreated();
			onOpenChange(false);
			setBrand("");
			setBrief("");
			setBudget("");
			setMaxPerCreator("");
			setRule({ amount: "", kind: "cpm_cents" });
			setSelectedPlatforms([]);
		} catch (err) {
			setError(describeError(err));
		} finally {
			setSaving(false);
		}
	}, [
		brand,
		brief,
		budget,
		call,
		maxPerCreator,
		onCreated,
		onOpenChange,
		rule,
		selectedPlatforms,
	]);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>New campaign</DialogTitle>
					<DialogDescription>
						Campaigns start as drafts. Amounts are stored as integer cents.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="ugc-campaign-brand">Brand</Label>
						<Input
							id="ugc-campaign-brand"
							onChange={(e) => setBrand(e.target.value)}
							placeholder="Acme"
							value={brand}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="ugc-campaign-brief">Brief</Label>
						<Textarea
							id="ugc-campaign-brief"
							onChange={(e) => setBrief(e.target.value)}
							placeholder="What creators should post, required hashtags and mentions…"
							value={brief}
						/>
					</div>
					<fieldset className="flex flex-col gap-1.5">
						<legend className="font-medium text-sm">Platforms</legend>
						<div className="flex flex-wrap gap-1.5">
							{platforms.length === 0 ? (
								<span className="text-muted-foreground text-xs">
									The sidecar reported no platforms.
								</span>
							) : null}
							{platforms.map((p) => (
								<Button
									aria-pressed={selectedPlatforms.includes(p.platform)}
									key={p.platform}
									onClick={() => togglePlatform(p.platform)}
									size="xs"
									type="button"
									variant={
										selectedPlatforms.includes(p.platform)
											? "secondary"
											: "outline"
									}
								>
									{p.label}
								</Button>
							))}
						</div>
					</fieldset>
					<div className="grid grid-cols-2 gap-2">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="ugc-campaign-budget">Budget (USD)</Label>
							<Input
								id="ugc-campaign-budget"
								inputMode="decimal"
								onChange={(e) => setBudget(e.target.value)}
								placeholder="0 = uncapped"
								value={budget}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="ugc-campaign-cap">Max per creator (USD)</Label>
							<Input
								id="ugc-campaign-cap"
								inputMode="decimal"
								onChange={(e) => setMaxPerCreator(e.target.value)}
								placeholder="0 = uncapped"
								value={maxPerCreator}
							/>
						</div>
					</div>
					<div className="grid grid-cols-2 gap-2">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="ugc-campaign-rule">Payout rule</Label>
							<NativeSelect
								className="w-full"
								id="ugc-campaign-rule"
								onChange={(e) =>
									setRule((prev) => ({
										...prev,
										kind: e.target.value as PayoutRuleDraft["kind"],
									}))
								}
								value={rule.kind}
							>
								<NativeSelectOption value="cpm_cents">
									Per 1,000 views
								</NativeSelectOption>
								<NativeSelectOption value="flat_cents">
									Flat per approved post
								</NativeSelectOption>
							</NativeSelect>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="ugc-campaign-rate">Rate (USD)</Label>
							<Input
								id="ugc-campaign-rate"
								inputMode="decimal"
								onChange={(e) =>
									setRule((prev) => ({ ...prev, amount: e.target.value }))
								}
								placeholder="2.50"
								value={rule.amount}
							/>
						</div>
					</div>
					{error ? <ErrorBanner message={error} /> : null}
				</div>
				<DialogFooter>
					<Button
						onClick={() => onOpenChange(false)}
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
					<Button
						disabled={saving || brand.trim().length === 0}
						onClick={() => {
							submit().catch(() => undefined);
						}}
						type="button"
					>
						{saving ? <Spinner className="size-3.5" /> : null}
						Create campaign
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Add someone to the roster. `display_name` is the sidecar's only required
 *  field; `handles` is a per-platform map, so it is collected as one row per
 *  curated platform rather than as free text a refresh could never match. */
function NewCreatorDialog({
	onCreated,
	onOpenChange,
	open,
}: {
	onCreated: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const call = useUgcCall();
	const [displayName, setDisplayName] = useState("");
	const [contactEmail, setContactEmail] = useState("");
	const [payoutHandle, setPayoutHandle] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const submit = useCallback(async () => {
		setError(null);
		setSaving(true);
		try {
			await call("/creators", {
				body: JSON.stringify({
					contact_email: contactEmail.trim() || null,
					display_name: displayName.trim(),
					payout_handle: payoutHandle.trim() || null,
				}),
				method: "POST",
			});
			onCreated();
			onOpenChange(false);
			setDisplayName("");
			setContactEmail("");
			setPayoutHandle("");
		} catch (err) {
			setError(describeError(err));
		} finally {
			setSaving(false);
		}
	}, [call, contactEmail, displayName, onCreated, onOpenChange, payoutHandle]);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add a creator</DialogTitle>
					<DialogDescription>
						The roster is shared across campaigns. Payout details are recorded
						here only — this app tracks what is owed, it does not move money.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="ugc-creator-name">Display name</Label>
						<Input
							id="ugc-creator-name"
							onChange={(e) => setDisplayName(e.target.value)}
							placeholder="Ada Lovelace"
							value={displayName}
						/>
					</div>
					<div className="grid grid-cols-2 gap-2">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="ugc-creator-email">Contact email</Label>
							<Input
								autoComplete="off"
								id="ugc-creator-email"
								onChange={(e) => setContactEmail(e.target.value)}
								placeholder="ada@example.com"
								type="email"
								value={contactEmail}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="ugc-creator-payout">Payout handle</Label>
							<Input
								id="ugc-creator-payout"
								onChange={(e) => setPayoutHandle(e.target.value)}
								placeholder="PayPal, bank alias…"
								value={payoutHandle}
							/>
						</div>
					</div>
					{error ? <ErrorBanner message={error} /> : null}
				</div>
				<DialogFooter>
					<Button
						onClick={() => onOpenChange(false)}
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
					<Button
						disabled={saving || displayName.trim().length === 0}
						onClick={() => {
							submit().catch(() => undefined);
						}}
						type="button"
					>
						{saving ? <Spinner className="size-3.5" /> : null}
						Add creator
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function NewSubmissionDialog({
	campaign,
	creators,
	onCreated,
	onOpenChange,
	open,
	platforms,
}: {
	campaign: Campaign;
	creators: Creator[];
	onCreated: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	platforms: PlatformSource[];
}) {
	const call = useUgcCall();
	const [creatorId, setCreatorId] = useState("");
	const [platform, setPlatform] = useState("");
	const [postUrl, setPostUrl] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	// A campaign that names its own platforms constrains the picker; otherwise
	// every curated platform is offered.
	const options = useMemo(() => {
		const declared = campaign.platforms ?? [];
		if (declared.length === 0) {
			return platforms;
		}
		return platforms.filter((p) => declared.includes(p.platform));
	}, [campaign.platforms, platforms]);

	const submit = useCallback(async () => {
		setError(null);
		setSaving(true);
		try {
			await call("/submissions", {
				body: JSON.stringify({
					campaign_id: campaign.id,
					creator_id: creatorId,
					platform,
					post_url: postUrl.trim(),
				}),
				method: "POST",
			});
			onCreated();
			onOpenChange(false);
			setPostUrl("");
		} catch (err) {
			// A duplicate post in this campaign comes back as a 409 with the
			// sidecar's own wording — show it, never swallow it into a success.
			setError(describeError(err));
		} finally {
			setSaving(false);
		}
	}, [
		call,
		campaign.id,
		creatorId,
		onCreated,
		onOpenChange,
		platform,
		postUrl,
	]);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Record a submission</DialogTitle>
					<DialogDescription>
						{campaign.brand || "This campaign"} — the post URL is parsed for the
						platform id that metric refreshes look up.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="ugc-submission-creator">Creator</Label>
						{creators.length === 0 ? (
							<p className="flex items-center gap-1.5 text-muted-foreground text-xs">
								<HugeiconsIcon className="size-3.5" icon={UserGroupIcon} />
								No creators on the roster yet.
							</p>
						) : (
							<NativeSelect
								className="w-full"
								id="ugc-submission-creator"
								onChange={(e) => setCreatorId(e.target.value)}
								value={creatorId}
							>
								<NativeSelectOption value="">
									Select a creator…
								</NativeSelectOption>
								{creators.map((c) => (
									<NativeSelectOption key={c.id} value={c.id}>
										{c.display_name}
									</NativeSelectOption>
								))}
							</NativeSelect>
						)}
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="ugc-submission-platform">Platform</Label>
						<NativeSelect
							className="w-full"
							id="ugc-submission-platform"
							onChange={(e) => setPlatform(e.target.value)}
							value={platform}
						>
							<NativeSelectOption value="">
								Select a platform…
							</NativeSelectOption>
							{options.map((p) => (
								<NativeSelectOption key={p.platform} value={p.platform}>
									{p.label}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="ugc-submission-url">Post URL</Label>
						<Input
							id="ugc-submission-url"
							onChange={(e) => setPostUrl(e.target.value)}
							placeholder="https://www.tiktok.com/@creator/video/7301…"
							spellCheck={false}
							value={postUrl}
						/>
					</div>
					{error ? <ErrorBanner message={error} /> : null}
				</div>
				<DialogFooter>
					<Button
						onClick={() => onOpenChange(false)}
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
					<Button
						disabled={
							saving ||
							creatorId.length === 0 ||
							platform.length === 0 ||
							postUrl.trim().length === 0
						}
						onClick={() => {
							submit().catch(() => undefined);
						}}
						type="button"
					>
						{saving ? <Spinner className="size-3.5" /> : null}
						Record submission
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** The five counters one snapshot carries, in the order an operator reads them
 *  off a platform's own analytics page. */
const METRIC_FIELDS = [
	{ key: "views", label: "Views" },
	{ key: "likes", label: "Likes" },
	{ key: "comments", label: "Comments" },
	{ key: "shares", label: "Shares" },
	{ key: "saves", label: "Saves" },
] as const;

type MetricField = (typeof METRIC_FIELDS)[number]["key"];
type MetricDraft = Record<MetricField, string>;
type MetricCounts = Record<MetricField, number>;

function draftFromSnapshot(
	latest: MetricSnapshot | null | undefined
): MetricDraft {
	return {
		comments: String(latest?.comments ?? 0),
		likes: String(latest?.likes ?? 0),
		saves: String(latest?.saves ?? 0),
		shares: String(latest?.shares ?? 0),
		views: String(latest?.views ?? 0),
	};
}

/** All five counters, or null if any box is not a whole number. Parsed as a set
 *  rather than field by field because the POST writes a whole snapshot — a body
 *  assembled from the boxes that happened to parse would store zeros for the
 *  ones that did not. */
function parseDraft(draft: MetricDraft): MetricCounts | null {
	const views = parseCount(draft.views);
	const likes = parseCount(draft.likes);
	const comments = parseCount(draft.comments);
	const shares = parseCount(draft.shares);
	const saves = parseCount(draft.saves);
	if (
		views === null ||
		likes === null ||
		comments === null ||
		shares === null ||
		saves === null
	) {
		return null;
	}
	return { comments, likes, saves, shares, views };
}

/** Enter a post's counters by hand.
 *
 *  This is the app's floor: it is the ONLY way to get metrics onto a platform
 *  the sidecar curates no Composio source for, and the correction path when an
 *  automated read is wrong — so it is offered whether or not Composio is
 *  connected on this node.
 *
 *  `POST /submissions/{id}/metrics` APPENDS a snapshot; it does not patch the
 *  previous one, and every counter absent from the body defaults to 0 in the
 *  sidecar's `MetricsBody`. The form therefore prefills from the newest reading
 *  and always sends all five: posting only the edited box would silently zero
 *  the other four, and the accrual that runs right after would re-price this
 *  post off those zeros. */
function RecordMetricsDialog({
	onClose,
	onRecorded,
	submission,
}: {
	onClose: () => void;
	onRecorded: () => void;
	submission: Submission;
}) {
	const call = useUgcCall();
	const [draft, setDraft] = useState<MetricDraft>(() =>
		draftFromSnapshot(submission.latest)
	);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const submissionId = submission.id;

	const submit = useCallback(async () => {
		setError(null);
		const counts = parseDraft(draft);
		if (counts === null) {
			setError("Every counter must be a whole number, e.g. 12000. Blank is 0.");
			return;
		}
		setSaving(true);
		try {
			await call(`/submissions/${encodeURIComponent(submissionId)}/metrics`, {
				body: JSON.stringify(counts),
				method: "POST",
			});
			onRecorded();
		} catch (err) {
			// A negative counter is a 400 and an unknown row a 404, both in the
			// sidecar's own wording. The dialog stays open showing it — a failed
			// write must never look like a recorded one.
			setError(describeError(err));
		} finally {
			setSaving(false);
		}
	}, [call, draft, onRecorded, submissionId]);

	return (
		<Dialog
			onOpenChange={(next) => {
				if (!next) {
					onClose();
				}
			}}
			open
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Record metrics</DialogTitle>
					<DialogDescription>
						Appends a reading to this post and re-runs its accrual. The boxes
						start at the newest reading, so correcting one leaves the rest as
						they were.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					<PostLink url={submission.post_url} />
					<div className="grid grid-cols-2 gap-2">
						{METRIC_FIELDS.map((field) => (
							<div className="flex flex-col gap-1.5" key={field.key}>
								<Label htmlFor={`ugc-metric-${field.key}`}>{field.label}</Label>
								<Input
									id={`ugc-metric-${field.key}`}
									inputMode="numeric"
									onChange={(e) =>
										setDraft((prev) => ({
											...prev,
											[field.key]: e.target.value,
										}))
									}
									value={draft[field.key]}
								/>
							</div>
						))}
					</div>
					{submission.latest ? (
						<p className="text-[11px] text-muted-foreground">
							Newest reading {formatDate(submission.latest.captured_at)},{" "}
							{submission.latest.source === "composio"
								? "read through Composio"
								: "entered by hand"}
							.
						</p>
					) : (
						<p className="text-[11px] text-muted-foreground">
							No reading on this post yet — these are the first.
						</p>
					)}
					{error ? <ErrorBanner message={error} /> : null}
				</div>
				<DialogFooter>
					<Button onClick={onClose} type="button" variant="ghost">
						Cancel
					</Button>
					<Button
						disabled={saving}
						onClick={() => {
							submit().catch(() => undefined);
						}}
						type="button"
					>
						{saving ? <Spinner className="size-3.5" /> : null}
						Record metrics
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Rejecting is transition-gated server-side and stamps a reason onto the row,
 *  so the reason is collected before the call rather than left blank. */
function RejectSubmissionDialog({
	onConfirm,
	onOpenChange,
	submission,
}: {
	onConfirm: (reason: string) => void;
	onOpenChange: (open: boolean) => void;
	submission: Submission | null;
}) {
	const [reason, setReason] = useState("");
	return (
		<Dialog onOpenChange={onOpenChange} open={submission !== null}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Reject this submission?</DialogTitle>
					<DialogDescription>
						The reason is stored on the submission and any accrued (unpaid)
						payout for it is removed.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="ugc-reject-reason">Reason</Label>
					<Textarea
						id="ugc-reject-reason"
						onChange={(e) => setReason(e.target.value)}
						placeholder="Missing the required hashtag…"
						value={reason}
					/>
				</div>
				<DialogFooter>
					<Button
						onClick={() => {
							setReason("");
							onOpenChange(false);
						}}
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
					<Button
						onClick={() => {
							onConfirm(reason.trim());
							setReason("");
						}}
						type="button"
						variant="destructive"
					>
						Reject submission
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
