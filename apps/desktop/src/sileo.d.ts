// sileo's published `SileoOptions` omits `id`, but its runtime reads it — the
// slot a toast lands in is `merged.id ?? "sileo-default"`, and it is the only
// handle a caller has on which slot it gets.
//
// That matters here beyond tidiness. The shared wrapper in
// `packages/ui/src/components/sileo.tsx` derives an id from
// `` `${title} ${description}` `` when the caller supplies none — and
// `description` accepts a ReactNode, which stringifies to `[object Object]`. So
// EVERY toast with a rendered (non-string) description would hash to the same id
// and stomp the previous one. The update toasts render their release notes as a
// ReactNode, so they must name their own slot.
//
// Declared as an augmentation rather than a local cast so the escape hatch is
// documented in one place instead of re-derived at each call site. The wrapper
// already carries the same note against its private `ToastOptions` alias.
//
// The empty type-only import is LOAD-BEARING: it is what makes this file a
// module, and only a module's `declare module "sileo"` is an *augmentation*.
// Without it TypeScript reads the block as an ambient module *declaration* that
// REPLACES the real one — every `import { sileo } from "sileo"` in the app then
// fails with "has no exported member 'sileo'".
import type {} from "sileo";

declare module "sileo" {
	interface SileoOptions {
		id?: string;
	}
}
