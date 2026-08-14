// Is the onboarding wizard the screen on display right now?
//
// Exists for exactly one reason: the Core/gateway installers emit
// `core-install-progress` / `gateway-install-progress`, and TWO listeners are
// subscribed to them — App.tsx (which raises a toast) and OnboardingPage (which
// drives the wizard's own progress bar and status line). During setup the user
// therefore saw the same download reported twice, once as a stack of toasts over
// a screen already reporting it.
//
// The wizard wins: it owns a dedicated, in-place progress surface, so the toast
// is pure duplication there and nothing else. Outside onboarding the toast is the
// only feedback that exists, so it stays.
//
// A module flag rather than a router read: App.tsx's listener is registered once
// at mount and never re-subscribes on navigation, so it has to ask the question at
// EMIT time. A ref that the wizard sets on mount answers exactly that, without
// coupling the listener to routing internals.

let active = false;

/** True while {@link OnboardingPage} is mounted. */
export function isOnboardingActive(): boolean {
	return active;
}

/** Mark the wizard mounted/unmounted. Called only from `OnboardingPage`. */
export function setOnboardingActive(next: boolean): void {
	active = next;
}
