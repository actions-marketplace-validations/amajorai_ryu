// The Dashboards Ryu App's identity, as the desktop shell knows it.
//
// The Home dashboard (`HomePage` — the widget grid/canvas) is a SHELL page, but the
// feature it renders belongs to `@ryu/dashboards`: the store, the refresh loop and
// the `/api/dashboards/*` surface all live in that app's out-of-process sidecar, and
// its sidebar button is already app-registered (`contributes.sidebar_buttons`). Only
// the route was still frozen into shell code at `/home`.
//
// So the shell names the APP, never the path — the same way `WHITEBOARD_PLUGIN_ID`
// does — and `contributions/app-shell-routes.ts` mints the route at whatever
// `sidebar_buttons[].target` the manifest declares. Moving the page is then a
// one-line manifest edit, and the route disappears when the app is disabled.

/** The Dashboards app's manifest id. Must match Core's
 *  `plugins::builtins::DASHBOARDS_PLUGIN_ID` and `apps-store/dashboards/manifest.json`. */
export const DASHBOARDS_PLUGIN_ID = "@ryu/dashboards";

/** The id of the app's sidebar button whose `target` the Home dashboard page mounts
 *  at. The id is the stable join key (a persisted sidebar layout is keyed on it);
 *  the target is the part the app may move. */
export const DASHBOARDS_HOME_BUTTON_ID = "home";

/** The path the manifest currently declares, mirrored for the two callers that
 *  cannot read the live contributions feed:
 *   - `computeStartupState()`, which seeds the "On startup → the Home page" tab
 *     before any provider (and therefore any react-query cache) exists;
 *   - the legacy-path migration below.
 *  Everything that CAN read the feed reads it (see `useAppShellPath`), so this is a
 *  cold-start default, not a second source of truth. */
export const DASHBOARD_DEFAULT_PATH = "/dashboard";

/** The path the dashboard used to be hardcoded at. Kept only to rewrite it out of a
 *  restored session — no route answers to it any more. */
export const LEGACY_DASHBOARD_PATH = "/home";
