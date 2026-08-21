# Welcome proof bundle

`welcome-step-story.html` and its React entrypoint are the source of truth for
the welcome proof. Run `bun run test:e2e:welcome` from `apps/desktop` to build
the bundle into the ignored repository `tmp/ryu-welcome-proof` directory and
serve that fresh output with Vite preview before Playwright starts.

The checked-in `dist-welcome/` directory is a static proof snapshot only. Do
not hand-edit its hashed files or rely on it for the test server; a source
change is verified through the build-before-serve command above.
