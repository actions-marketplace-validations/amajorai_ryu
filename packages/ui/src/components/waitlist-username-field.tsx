"use client";

import { useId } from "react";
import { cn } from "../lib/utils.ts";
import { Button } from "./button.tsx";
import { Spinner } from "./spinner.tsx";

/**
 * "Reserve your handle" field for the waitlist screens. Presentational only —
 * it owns no auth: the web and desktop screens each hold their own Better Auth
 * client (`authClient.isUsernameAvailable` + `authClient.updateUser`) and pass
 * the result in, because those two clients are configured differently (cookie
 * vs. bearer) and neither belongs in the shared UI package.
 *
 * Once reserved the field collapses to the confirmation line rather than staying
 * editable: reserving a handle is the one irreversible-feeling thing on the
 * page, and an input that still looks editable invites a user to believe they
 * can trade it away for another one that might already be gone.
 */

/** Same shape Better Auth's username plugin enforces (3-32, word chars). */
export const WAITLIST_USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const USERNAME_MAX_LENGTH = 32;
const LEADING_AT = /^@+/;

/** Strip a typed "@", lowercase, and trim to the shape the server accepts. */
export const normalizeWaitlistUsername = (raw: string): string =>
	raw
		.trim()
		.replace(LEADING_AT, "")
		.toLowerCase()
		.slice(0, USERNAME_MAX_LENGTH);

export interface WaitlistUsernameFieldProps {
	className?: string;
	/** Inline error from the last attempt (taken, invalid, network). */
	error?: string | null;
	onChange: (value: string) => void;
	onSubmit: () => void;
	/** In flight: checking availability and claiming. */
	pending?: boolean;
	/** Already reserved — renders the confirmation instead of the input. */
	reserved?: string | null;
	value: string;
}

export function WaitlistUsernameField({
	className,
	error,
	onChange,
	onSubmit,
	pending = false,
	reserved,
	value,
}: WaitlistUsernameFieldProps) {
	const inputId = useId();
	const errorId = useId();
	const normalized = normalizeWaitlistUsername(value);
	const valid = WAITLIST_USERNAME_RE.test(normalized);

	if (reserved) {
		return (
			<div
				className={cn(
					"flex flex-col gap-1 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3",
					className
				)}
			>
				<p className="font-medium text-sm">
					<span className="font-mono">@{reserved}</span> is reserved
				</p>
				<p className="text-muted-foreground text-xs">
					It&apos;s yours the moment you&apos;re in. We&apos;ll let you know.
				</p>
			</div>
		);
	}

	return (
		<form
			className={cn("flex flex-col gap-2", className)}
			onSubmit={(event) => {
				event.preventDefault();
				if (!(pending || !valid)) {
					onSubmit();
				}
			}}
		>
			<label className="text-muted-foreground text-xs" htmlFor={inputId}>
				Reserve your handle
			</label>
			<div className="flex items-center gap-2">
				{/* The "@" is a prefix inside the control, not part of the value, so a
				    user who types it anyway is normalized rather than rejected. */}
				<div className="flex h-9 min-w-0 flex-1 items-center rounded-md border bg-transparent px-3 focus-within:ring-[3px] focus-within:ring-ring/50">
					<span
						aria-hidden="true"
						className="font-mono text-muted-foreground text-sm"
					>
						@
					</span>
					<input
						aria-describedby={error ? errorId : undefined}
						aria-invalid={Boolean(error)}
						autoCapitalize="none"
						autoComplete="off"
						autoCorrect="off"
						className="min-w-0 flex-1 bg-transparent px-1 font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground"
						id={inputId}
						maxLength={USERNAME_MAX_LENGTH}
						onChange={(event) => onChange(event.target.value)}
						placeholder="yourname"
						spellCheck={false}
						value={value}
					/>
				</div>
				<Button disabled={pending || !valid} size="sm" type="submit">
					{pending ? (
						<span className="flex items-center gap-2">
							<Spinner className="size-3.5" />
							Reserving
						</span>
					) : (
						"Reserve"
					)}
				</Button>
			</div>
			{error ? (
				<p className="text-destructive text-xs" id={errorId}>
					{error}
				</p>
			) : (
				<p className="text-muted-foreground text-xs">
					3–32 letters, numbers or underscores. Yours to keep when you&apos;re
					in.
				</p>
			)}
		</form>
	);
}
