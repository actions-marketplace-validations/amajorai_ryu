// apps/desktop/src/components/settings/SpacesSettings.tsx
//
// The Spaces app's settings body, reached at Gateway settings → Apps → Spaces.
//
// It exists because the editor's inline AI and the document embedder had no home
// in the product at all. Both are node-scoped settings owned by Spaces — they
// govern documents in a Space, not the desktop client — yet the only surface that
// rendered them was the standalone `/settings` route, which nothing links to from
// the place the feature actually runs. So the editor's own failure message ("Turn
// it on in Settings → Editor and pick a model") named a screen the user had no way
// to find, for a feature that should not have needed configuring in the first
// place (it now inherits the node's default agent — see `useRegisterEditorAi`).
//
// Registered the ordinary way: `contributes.settings_tabs[].view` on the Spaces
// manifest, bound to this component by plugin id in `EntitySettings`.

import { EditorEmbeddingSettings } from "./EditorEmbeddingSettings.tsx";

export function SpacesSettings() {
	return <EditorEmbeddingSettings />;
}

export default SpacesSettings;
