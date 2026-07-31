"use client";

import type { ComponentProps } from "react";
import { type SileoOptions, Toaster as SileoToaster, sileo } from "sileo";

type ToasterProps = ComponentProps<typeof SileoToaster>;

// sileo clamps `autopilot.collapse` to the toast's own duration, so asking for an
// absurdly large collapse delay means "stay expanded until the toast exits" for
// ANY duration a caller passes.
const COLLAPSE_AT_END_OF_LIFE = Number.MAX_SAFE_INTEGER;

// The mounted Toaster sets sileo's GLOBAL `store.options`, which every toast
// merges over — including the ~40 call sites that import `sileo` directly and
// bypass the `toast` wrapper below. So this is the one place we can force sane
// timing for ALL toasts at once:
//   - `duration: 6000` — a readable 6s lifetime.
//   - `autopilot` — sileo's default collapses the toast 2s BEFORE it is
//     dismissed, which reads as if it vanished early. We keep auto-expand (it is
//     the only thing that reveals a toast's `description` without a hover) but
//     push the collapse to the end of life, so a toast stays open the whole time
//     it is on screen. Turning autopilot off entirely — the previous fix — hid
//     every description behind a hover.
// Caller-supplied `options` still win via the spread.
const DEFAULT_TOASTER_OPTIONS = {
	autopilot: { collapse: COLLAPSE_AT_END_OF_LIFE, expand: 150 },
	duration: 6000,
	fill: "var(--muted)",
} as const;

const Toaster = ({ options, ...props }: ToasterProps) => {
	return (
		<SileoToaster
			options={{ ...DEFAULT_TOASTER_OPTIONS, ...options }}
			{...props}
		/>
	);
};

// `SileoOptions` omits `id`, but the runtime reads it (`merged.id ?? "sileo-default"`)
// and it is the only handle on which slot a toast lands in, so we type it here.
type ToastOptions = SileoOptions & { id?: string };
type RawToast = (opts: SileoOptions) => string;

// sileo's toast API takes an options object; this adapter also accepts a plain
// string (mapped to the `title`) so callers can write `toast.error("...")` like
// sonner. Exposed as `toast` so app code stays toast-library-agnostic.
type ToastInput = string | ToastOptions;

const asOptions = (input: ToastInput): ToastOptions =>
	typeof input === "string" ? { title: input } : input;

// sileo defaults every id-less toast to the shared id "sileo-default", so two
// toasts fired in succession collapse into one slot — the second REPLACES the
// first, which is why a toast could flash for a moment and vanish before it was
// readable. We give each toast a CONTENT-derived id instead, which fixes both
// failure modes:
//   - distinct messages get distinct ids, so they stack instead of stomping;
//   - a component that re-fires the SAME message in a render/effect loop reuses
//     one slot (sileo replaces it in place, restarting its full duration)
//     instead of spawning a flickering pile.
const toastContentId = (base: ToastOptions) => {
	const key = `${base.title ?? ""} ${base.description ?? ""}`;
	// Cheap stable hash so the id is a short, DOM-safe string.
	let hash = 0;
	for (let i = 0; i < key.length; i += 1) {
		hash = (hash * 31 + key.charCodeAt(i)) | 0;
	}
	return `ryu-toast-${(hash >>> 0).toString(36)}`;
};

// ...but content ids alone are WRONG for progress toasts. Auth flows fire a chain
// of `{ type: "loading", duration: null }` toasts ("Verifying captcha..." →
// "Signing in...") and then a terminal `success`/`error`, and they never dismiss
// anything: they rely on every step landing in ONE slot so each step replaces the
// previous and the terminal toast (which has a real duration) retires it. Give
// those steps content ids and each becomes its own never-expiring toast — the
// stack of stuck spinners on the web login. So progress toasts share a single
// slot, and the next terminal toast takes that slot over, exactly as the flows
// (and sileo's own `promise` helper) assume.
const PROGRESS_ID = "ryu-toast-progress";
let progressSlotLive = false;

const withSlotId = (base: ToastOptions, isProgress: boolean): ToastOptions => {
	// The caller named the slot (e.g. to update one specific toast) — respect it.
	if (base.id !== undefined) {
		return base;
	}
	if (isProgress) {
		progressSlotLive = true;
		return { ...base, id: PROGRESS_ID };
	}
	// Terminal toast while a progress toast is on screen: replace it in place.
	if (progressSlotLive) {
		progressSlotLive = false;
		return { ...base, id: PROGRESS_ID };
	}
	return { ...base, id: toastContentId(base) };
};

// ~40 call sites import `sileo` directly from "sileo" and never pass an id, so
// they all share the lib's "sileo-default" slot. That shared slot is why "press
// Update and nothing happens": a flow that shows a progress toast, dismisses it,
// and immediately fires an error toast reuses ONE id — the dismiss races the new
// toast and swallows it. Patching the shared instance here (this module is
// loaded once, by the mounted Toaster) gives every direct caller the same slot
// rules as the `toast` wrapper below, without touching 40 files.
type PatchedSileo = typeof sileo & { __ryuSlotsPatched?: true };
const patchTarget = sileo as PatchedSileo;

if (!patchTarget.__ryuSlotsPatched) {
	const raw = {
		show: sileo.show as RawToast,
		success: sileo.success as RawToast,
		error: sileo.error as RawToast,
		warning: sileo.warning as RawToast,
		info: sileo.info as RawToast,
		action: sileo.action as RawToast,
		dismiss: sileo.dismiss,
		clear: sileo.clear,
	} as const;

	const route = (fn: RawToast, opts: ToastOptions, isProgress: boolean) =>
		fn(withSlotId(opts, isProgress) as SileoOptions);

	// `show` is the only entry point that can carry `type: "loading"`; the typed
	// helpers below always describe a terminal state.
	sileo.show = (opts) => route(raw.show, opts, opts.type === "loading");
	sileo.success = (opts) => route(raw.success, opts, false);
	sileo.error = (opts) => route(raw.error, opts, false);
	sileo.warning = (opts) => route(raw.warning, opts, false);
	sileo.info = (opts) => route(raw.info, opts, false);
	sileo.action = (opts) => route(raw.action, opts, false);
	sileo.dismiss = (id) => {
		if (id === PROGRESS_ID) {
			progressSlotLive = false;
		}
		raw.dismiss(id);
	};
	sileo.clear = (position) => {
		progressSlotLive = false;
		raw.clear(position);
	};

	patchTarget.__ryuSlotsPatched = true;
}

const toast = {
	show: (input: ToastInput) => sileo.show(asOptions(input)),
	message: (input: ToastInput) => sileo.show(asOptions(input)),
	success: (input: ToastInput) => sileo.success(asOptions(input)),
	error: (input: ToastInput) => sileo.error(asOptions(input)),
	warning: (input: ToastInput) => sileo.warning(asOptions(input)),
	info: (input: ToastInput) => sileo.info(asOptions(input)),
	dismiss: (id: string) => sileo.dismiss(id),
};

export { Toaster, toast };
