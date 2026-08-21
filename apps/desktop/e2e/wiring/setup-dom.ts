import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Bun evaluates every file in this directory in the same process. Keep the
// process-wide happy-dom registration idempotent so the wiring suites can run
// together or individually without one file clobbering another.
if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register();
}
